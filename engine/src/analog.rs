use std::f64::consts::TAU;

pub const PIN_STRIDE: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PartKind {
    Ground,
    Switch,
    Spdt,
    Pot,
    Dc,
    Current,
    Resistance,
    Ammeter,
    Capacitor,
    Inductor,
    Diode,
    Zener,
    Open,
    Sine,
    Square,
    Triangle,
    Motor,
}

impl PartKind {
    pub fn from_code(code: usize) -> Option<Self> {
        use PartKind::*;
        [
            Ground, Switch, Spdt, Pot, Dc, Current, Resistance, Ammeter, Capacitor, Inductor,
            Diode, Zener, Open, Sine, Square, Triangle, Motor,
        ]
        .get(code)
        .copied()
    }
}

#[derive(Clone, Copy)]
pub struct Part {
    pub kind: PartKind,
    pub pins: usize,
    pub value: f64,
    pub frequency: f64,
    pub state: State,
    pub motor: Motor,
}

#[derive(Clone, Copy, Default)]
pub struct State {
    // Capacitor voltage or inductor/motor winding current.
    pub electrical: f64,
    pub speed: f64,
}

#[derive(Clone, Copy, Default)]
pub struct Motor {
    pub inductance: f64,
    pub inertia: f64,
    pub constant: f64,
    pub damping: f64,
    pub load: f64,
}

impl Motor {
    fn speed_terms(self, previous: f64, step: Option<TimeStep>) -> (f64, f64) {
        match step {
            Some(step) => {
                let denominator = self.inertia + step.step * self.damping;
                (
                    (self.inertia * previous - step.step * self.load) / denominator,
                    step.step * self.constant / denominator,
                )
            }
            None => (-self.load / self.damping, self.constant / self.damping),
        }
    }
}

#[derive(Clone, Copy)]
pub struct TimeStep {
    pub time: f64,
    pub step: f64,
}

#[derive(Debug)]
pub enum Error {
    OpenCurrentSource,
    Singular,
    NonConvergent,
    StepTooSmall,
}

pub struct Reading {
    pub volts: Vec<f64>,
    pub reference_groups: Vec<f64>,
    pub currents: Vec<f64>,
    pub states: Vec<State>,
    pub wire_currents: Vec<f64>,
}

#[derive(Clone, Copy, PartialEq)]
enum Model {
    Voltage(f64),
    Conductance(f64, f64),
    Current(f64),
    Diode(f64, Option<f64>),
}

struct Branch {
    part: usize,
    pins: [usize; 2],
    nodes: [usize; 2],
    model: Model,
}

fn root(parents: &[usize], mut node: usize) -> usize {
    while parents[node] != node {
        node = parents[node];
    }
    node
}

fn ideal_connections(parts: &[Part], ground: usize) -> Vec<[usize; 2]> {
    use PartKind::*;
    parts
        .iter()
        .enumerate()
        .filter_map(|(index, part)| {
            let pin = index * PIN_STRIDE;
            match part.kind {
                Ground => Some([pin, ground]),
                Switch if part.value != 0.0 => Some([pin, pin + 1]),
                Spdt => Some([pin, pin + if part.value == 0.0 { 1 } else { 2 }]),
                Pot if part.value == 0.0 => Some([pin, pin + 2]),
                Pot if part.value == 100.0 => Some([pin + 1, pin + 2]),
                _ => None,
            }
        })
        .collect()
}

fn branches(parts: &[Part], nodes: &[usize], transient: Option<TimeStep>) -> Vec<Branch> {
    use PartKind::*;
    let mut branches = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        let pin = index * PIN_STRIDE;
        let mut add = |model, from, to| {
            branches.push(Branch {
                part: index,
                pins: [pin + from, pin + to],
                nodes: [nodes[pin + from], nodes[pin + to]],
                model,
            })
        };
        let value = part.value;
        let model = match part.kind {
            Dc => Model::Voltage(value),
            Current => Model::Current(value / 1000.0),
            Resistance => Model::Conductance(1.0 / value, 0.0),
            Ammeter => Model::Conductance(100.0, 0.0),
            Sine | Square | Triangle => {
                let voltage = transient.map_or(0.0, |step| {
                    let cycle = (part.frequency * step.time).rem_euclid(1.0);
                    let wave = match part.kind {
                        Square => {
                            if cycle < 0.5 {
                                1.0
                            } else {
                                -1.0
                            }
                        }
                        Triangle => 1.0 - 4.0 * ((cycle + 0.25).rem_euclid(1.0) - 0.5).abs(),
                        _ => (TAU * cycle).sin(),
                    };
                    value * wave
                });
                Model::Voltage(voltage)
            }
            Capacitor => {
                let Some(step) = transient else { continue };
                let g = value * 1e-6 / step.step;
                Model::Conductance(g, -g * part.state.electrical)
            }
            Inductor => {
                let reactance = transient.map_or(0.0, |step| value * 1e-3 / step.step);
                let g = 1.0 / (0.1 + reactance);
                Model::Conductance(g, g * reactance * part.state.electrical)
            }
            Motor => {
                // Eliminate speed from L di/dt = v - Ri - Kω and J dω/dt = Ki - bω - T_load.
                let motor = part.motor;
                let (speed_offset, speed_per_amp) = motor.speed_terms(part.state.speed, transient);
                let reactance = transient.map_or(0.0, |step| motor.inductance / step.step);
                let g = 1.0 / (value + reactance + motor.constant * speed_per_amp);
                Model::Conductance(
                    g,
                    g * (reactance * part.state.electrical - motor.constant * speed_offset),
                )
            }
            Diode => Model::Diode(value, None),
            Zener => Model::Diode(0.7, Some(value)),
            Pot => {
                let left = value * 100.0;
                if left > 0.0 {
                    add(Model::Conductance(1.0 / left, 0.0), 0, 2);
                }
                if left < 10000.0 {
                    add(Model::Conductance(1.0 / (10000.0 - left), 0.0), 2, 1);
                }
                continue;
            }
            _ => continue,
        };
        add(model, 0, 1);
    }
    branches
}

fn response(model: Model, voltage: f64) -> (f64, f64) {
    match model {
        Model::Conductance(g, offset) => (g * voltage + offset, g),
        Model::Current(value) => (value, 0.0),
        Model::Diode(threshold, breakdown) => {
            // The 10 mV knee keeps the slope continuous for the nonlinear solve.
            fn knee(overdrive: f64) -> (f64, f64) {
                if overdrive <= 0.0 {
                    (0.0, 0.0)
                } else if overdrive >= 0.01 {
                    (overdrive - 0.005, 1.0)
                } else {
                    (overdrive * overdrive / 0.02, overdrive / 0.01)
                }
            }
            let (forward, forward_slope) = knee(voltage - threshold);
            let (reverse, reverse_slope) =
                breakdown.map_or((0.0, 0.0), |limit| knee(-voltage - limit));
            (
                voltage * 1e-9 + (forward - reverse) / 2.0,
                1e-9 + (forward_slope + reverse_slope) / 2.0,
            )
        }
        Model::Voltage(_) => unreachable!("voltage sources have a separate matrix row"),
    }
}

struct Matrix {
    n: usize,
    data: Vec<f64>,
}

impl Matrix {
    fn new(n: usize) -> Self {
        Self {
            n,
            data: vec![0.0; n * (n + 1)],
        }
    }

    fn add(&mut self, row: Option<usize>, column: Option<usize>, value: f64) {
        if let (Some(row), Some(column)) = (row, column) {
            self.data[row * (self.n + 1) + column] += value;
        }
    }

    fn solve(mut self) -> Result<Vec<f64>, Error> {
        let stride = self.n + 1;
        for col in 0..self.n {
            let pivot = (col..self.n)
                .max_by(|&a, &b| {
                    self.data[a * stride + col]
                        .abs()
                        .total_cmp(&self.data[b * stride + col].abs())
                })
                .unwrap();
            if self.data[pivot * stride + col].abs() < 1e-12 {
                return Err(Error::Singular);
            }
            for i in col..stride {
                self.data.swap(col * stride + i, pivot * stride + i);
            }
            let divisor = self.data[col * stride + col];
            for i in col..stride {
                self.data[col * stride + i] /= divisor;
            }
            for row in 0..self.n {
                if row == col {
                    continue;
                }
                let factor = self.data[row * stride + col];
                if factor == 0.0 {
                    continue;
                }
                for i in col..stride {
                    self.data[row * stride + i] -= factor * self.data[col * stride + i];
                }
            }
        }
        Ok(self
            .data
            .chunks_exact(stride)
            .map(|row| row[self.n])
            .collect())
    }

    fn residual(&self, values: &[f64]) -> f64 {
        self.data
            .chunks_exact(self.n + 1)
            .map(|row| {
                row.iter()
                    .zip(values)
                    .fold(-row[self.n], |sum, (a, b)| sum + a * b)
                    .abs()
            })
            .fold(0.0, f64::max)
    }
}

fn nonlinear(initial: Vec<f64>, linearize: impl Fn(&[f64]) -> Matrix) -> Result<Vec<f64>, Error> {
    let mut values = initial;
    for _ in 0..80 {
        let matrix = linearize(&values);
        let error = matrix.residual(&values);
        if error < 1e-8 {
            return Ok(values);
        }
        let next = matrix.solve()?;
        let accepted = (0..=12).find_map(|power| {
            let step = 1.0 / f64::from(1 << power);
            let candidate: Vec<_> = values
                .iter()
                .zip(&next)
                .map(|(&a, &b)| a + step * (b - a))
                .collect();
            (linearize(&candidate).residual(&candidate) < error).then_some(candidate)
        });
        let Some(candidate) = accepted else { break };
        values = candidate;
    }
    Err(Error::NonConvergent)
}

fn carries_state(kind: PartKind) -> bool {
    matches!(
        kind,
        PartKind::Capacitor | PartKind::Inductor | PartKind::Motor
    )
}

fn integrate(
    parts: &[Part],
    wires: &[[usize; 2]],
    start: f64,
    step: f64,
    end: f64,
) -> Result<Reading, Error> {
    // The two-stage, second-order L-stable SDIRK method damps unresolved stiff
    // modes. Each stage uses the same implicit circuit stamps.
    const GAMMA: f64 = 1.0 - std::f64::consts::FRAC_1_SQRT_2;
    let diagonal = GAMMA * step;
    let stage = measure(
        parts,
        wires,
        Some(TimeStep {
            time: start + diagonal,
            step: diagonal,
        }),
    )?;
    let weight = (1.0 - GAMMA) / GAMMA;
    let stage_parts: Vec<_> = parts
        .iter()
        .zip(stage.states)
        .map(|(&part, state)| {
            let previous = part.state;
            Part {
                state: State {
                    electrical: previous.electrical
                        + weight * (state.electrical - previous.electrical),
                    speed: previous.speed + weight * (state.speed - previous.speed),
                },
                ..part
            }
        })
        .collect();
    measure(
        &stage_parts,
        wires,
        Some(TimeStep {
            time: end,
            step: diagonal,
        }),
    )
}

fn state_error(parts: &[Part], coarse: &Reading, fine: &Reading) -> f64 {
    const RELATIVE: f64 = 1e-5;
    let scaled = |a: f64, b: f64, absolute: f64| {
        (a - b).abs() / (3.0 * (absolute + RELATIVE * a.abs().max(b.abs())))
    };
    parts
        .iter()
        .zip(coarse.states.iter().zip(&fine.states))
        .filter_map(|(part, (a, b))| {
            let electrical_tolerance = match part.kind {
                PartKind::Capacitor => 1e-7,                  // volts
                PartKind::Inductor | PartKind::Motor => 1e-9, // amperes
                _ => return None,
            };
            Some(
                scaled(a.electrical, b.electrical, electrical_tolerance)
                    .max(scaled(a.speed, b.speed, 1e-5)),
            )
        })
        .fold(0.0, f64::max)
}

pub fn advance(
    parts: &[Part],
    wires: &[[usize; 2]],
    start: f64,
    max_step: f64,
) -> Result<(Reading, f64, f64), Error> {
    let dynamic = parts.iter().any(|part| carries_state(part.kind));
    let edge = parts
        .iter()
        .filter(|part| part.kind == PartKind::Square && part.frequency > 0.0)
        .map(|part| {
            let edges_per_second = 2.0 * part.frequency;
            ((start * edges_per_second + 1e-10).floor() + 1.0) / edges_per_second
        })
        .fold(f64::INFINITY, f64::min);
    let until_edge = edge - start;
    let mut step = max_step.min(until_edge);
    for _ in 0..40 {
        if start + step * 0.5 <= start {
            return Err(Error::StepTooSmall);
        }
        // Integrate up to a square-wave edge using its left-hand value.
        let end = if step == until_edge {
            edge - edge.abs().max(1.0) * 8.0 * f64::EPSILON
        } else {
            start + step
        };
        if !dynamic {
            return Ok((
                measure(parts, wires, Some(TimeStep { time: end, step }))?,
                step,
                max_step,
            ));
        }
        let trial = (|| {
            let coarse = integrate(parts, wires, start, step, end)?;
            let half = step * 0.5;
            let midpoint = integrate(parts, wires, start, half, start + half)?;
            let middle_parts: Vec<_> = parts
                .iter()
                .zip(midpoint.states)
                .map(|(&part, state)| Part { state, ..part })
                .collect();
            let fine = integrate(&middle_parts, wires, start + half, half, end)?;
            Ok((state_error(parts, &coarse, &fine), fine))
        })();
        match trial {
            Ok((error, fine)) => {
                let next = step * (0.9 / error.cbrt()).clamp(0.2, 2.0);
                if error <= 1.0 {
                    return Ok((fine, step, next));
                }
                step = next;
            }
            Err(Error::NonConvergent) => step *= 0.25,
            Err(error) => return Err(error),
        }
    }
    Err(Error::StepTooSmall)
}

pub fn measure(
    parts: &[Part],
    wires: &[[usize; 2]],
    transient: Option<TimeStep>,
) -> Result<Reading, Error> {
    let ground = parts.len() * PIN_STRIDE;
    let ideal = ideal_connections(parts, ground);
    let mut parents: Vec<_> = (0..=ground).collect();
    for &[a, b] in wires.iter().chain(&ideal) {
        let (a, b) = (root(&parents, a), root(&parents, b));
        if a == b {
            continue;
        }
        if a == ground {
            parents[b] = a;
        } else {
            parents[a] = b;
        }
    }
    let nodes: Vec<_> = (0..=ground).map(|pin| root(&parents, pin)).collect();
    let mut branches = branches(parts, &nodes, transient);
    // A voltage can be compared only within an island with a common reference.
    // An ideal current source specifies no voltage difference between its ends.
    let mut network: Vec<_> = (0..=ground).collect();
    let mut active = vec![false; ground + 1];
    active[ground] = true;
    for branch in &branches {
        let [a, b] = branch.nodes;
        if !matches!(branch.model, Model::Current(_)) {
            active[a] = true;
            active[b] = true;
            let (a, b) = (root(&network, a), root(&network, b));
            network[a] = b;
        }
    }
    let groups: Vec<_> = (0..=ground).map(|node| root(&network, node)).collect();
    let ground_group = groups[ground];
    let mut references = vec![None; ground + 1];
    references[ground_group] = Some(ground);
    for branch in &branches {
        if matches!(branch.model, Model::Voltage(_)) {
            let negative = branch.nodes[1];
            references[groups[negative]].get_or_insert(negative);
        }
    }
    for node in 0..ground {
        if active[node] {
            references[groups[node]].get_or_insert(node);
        }
    }
    if branches.iter().any(|branch| {
        let [a, b] = branch.nodes;
        matches!(branch.model, Model::Current(i) if i != 0.0)
            && (active[a] || active[b])
            && groups[a] != groups[b]
    }) {
        return Err(Error::OpenCurrentSource);
    }
    branches.retain(|branch| branch.nodes.iter().all(|&node| active[node]));
    let is_reference = |node: usize| references[groups[node]] == Some(node);
    let mut indices = vec![None; ground + 1];
    let mut count = 0;
    for node in 0..ground {
        if active[node] && !is_reference(node) {
            indices[node] = Some(count);
            count += 1;
        }
    }
    let source_rows: Vec<_> = branches
        .iter()
        .map(|branch| {
            if matches!(branch.model, Model::Voltage(_)) {
                let row = count;
                count += 1;
                Some(row)
            } else {
                None
            }
        })
        .collect();
    let voltage = |node: usize, values: &[f64]| {
        if is_reference(node) {
            0.0
        } else {
            indices[node].map_or(f64::NAN, |i| values[i])
        }
    };
    let drop = |branch: &Branch, values: &[f64]| {
        voltage(branch.nodes[0], values) - voltage(branch.nodes[1], values)
    };
    let linearize = |values: &[f64]| {
        let mut matrix = Matrix::new(count);
        for (branch, source) in branches.iter().zip(&source_rows) {
            let [a, b] = branch.nodes.map(|node| indices[node]);
            if let Model::Voltage(value) = branch.model {
                matrix.add(a, *source, 1.0);
                matrix.add(b, *source, -1.0);
                matrix.add(*source, a, 1.0);
                matrix.add(*source, b, -1.0);
                matrix.add(*source, Some(count), value);
            } else {
                let v = drop(branch, values);
                let (g, offset) = match branch.model {
                    Model::Conductance(g, offset) => (g, offset),
                    _ => {
                        let (current, g) = response(branch.model, v);
                        (g, current - g * v)
                    }
                };
                matrix.add(a, a, g);
                matrix.add(b, b, g);
                matrix.add(a, b, -g);
                matrix.add(b, a, -g);
                matrix.add(a, Some(count), -offset);
                matrix.add(b, Some(count), offset);
            }
        }
        matrix
    };
    let mut solution = linearize(&vec![0.0; count]).solve()?;
    if branches
        .iter()
        .any(|branch| matches!(branch.model, Model::Diode(..)))
    {
        solution = nonlinear(solution, linearize)?;
    }
    let volts: Vec<_> = nodes.iter().map(|&node| voltage(node, &solution)).collect();
    let mut currents = vec![f64::NAN; parts.len()];
    let mut states = vec![State::default(); parts.len()];
    let mut terminals = vec![0.0; ground + 1];
    for (branch, source) in branches.iter().zip(source_rows) {
        let v = drop(branch, &solution);
        let current = source.map_or_else(|| response(branch.model, v).0, |row| solution[row]);
        let [a, b] = branch.pins;
        terminals[a] += current;
        terminals[b] -= current;
        let part = branch.part;
        if parts[part].kind != PartKind::Pot {
            currents[part] = current;
        }
        let device = parts[part];
        match device.kind {
            PartKind::Capacitor => states[part].electrical = v,
            PartKind::Inductor => states[part].electrical = current,
            PartKind::Motor => {
                let (offset, per_amp) = device.motor.speed_terms(device.state.speed, transient);
                states[part] = State {
                    electrical: current,
                    speed: offset + per_amp * current,
                };
            }
            _ => {}
        }
    }
    for (index, part) in parts.iter().enumerate() {
        if part.kind == PartKind::Open || (part.kind == PartKind::Capacitor && transient.is_none())
        {
            currents[index] = 0.0;
        }
    }
    let wire_currents = recover_wire_currents(wires, &ideal, &volts, &terminals);
    let reference_groups = nodes
        .iter()
        .map(|&node| {
            if !active[node] {
                f64::NAN
            } else if groups[node] == ground_group {
                0.0
            } else {
                (groups[node] + 1) as f64
            }
        })
        .collect();
    Ok(Reading {
        volts,
        reference_groups,
        currents,
        states,
        wire_currents,
    })
}

fn recover_wire_currents(
    wires: &[[usize; 2]],
    ideal: &[[usize; 2]],
    volts: &[f64],
    currents: &[f64],
) -> Vec<f64> {
    struct Traversal<'a> {
        edges: &'a [[usize; 2]],
        graph: Vec<Vec<usize>>,
        seen: Vec<Option<usize>>,
        order: usize,
        volts: &'a [f64],
        currents: &'a [f64],
        result: Vec<f64>,
    }
    impl Traversal<'_> {
        // A bridge carries all current drawn on its far side. An ideal loop has no unique split.
        fn walk(&mut self, node: usize, parent: Option<usize>) -> (usize, f64) {
            let order = self.order;
            self.order += 1;
            self.seen[node] = Some(order);
            let mut low = order;
            let mut sum = self.currents[node];
            for index in 0..self.graph[node].len() {
                let edge = self.graph[node][index];
                if Some(edge) == parent {
                    continue;
                }
                let [a, b] = self.edges[edge];
                let next = if a == node { b } else { a };
                if let Some(seen) = self.seen[next] {
                    low = low.min(seen);
                    continue;
                }
                let (subtree, current) = self.walk(next, Some(edge));
                low = low.min(subtree);
                sum += current;
                if edge < self.result.len() && subtree > order && self.volts[node].is_finite() {
                    self.result[edge] = if a == node { current } else { -current };
                }
            }
            (low, sum)
        }
    }
    let edges: Vec<_> = wires.iter().chain(ideal).copied().collect();
    let mut graph = vec![Vec::new(); volts.len()];
    for (index, &[a, b]) in edges.iter().enumerate() {
        graph[a].push(index);
        graph[b].push(index);
    }
    let mut traversal = Traversal {
        edges: &edges,
        graph,
        seen: vec![None; volts.len()],
        order: 0,
        volts,
        currents,
        result: vec![f64::NAN; wires.len()],
    };
    for node in 0..volts.len() {
        if traversal.seen[node].is_none() && !traversal.graph[node].is_empty() {
            traversal.walk(node, None);
        }
    }
    traversal.result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(kind: PartKind, value: f64) -> Part {
        Part {
            kind,
            value,
            pins: 2,
            frequency: 0.0,
            state: State::default(),
            motor: Motor::default(),
        }
    }

    #[test]
    fn ungrounded_rc_charges_and_discharges() {
        let mut parts = [
            part(PartKind::Dc, 5.0),
            part(PartKind::Resistance, 10_000.0),
            part(PartKind::Capacitor, 100.0),
        ];
        let dt = TimeStep {
            time: 0.0,
            step: 0.1,
        };
        let charging = [[0, 3], [4, 6], [7, 1]];
        let first = measure(&parts, &charging, Some(dt)).unwrap();
        assert!((first.states[2].electrical - 5.0 / 11.0).abs() < 1e-9);
        assert!(first.wire_currents[0] > 0.0);
        assert_eq!(first.reference_groups[6], first.reference_groups[7]);
        assert!(first.reference_groups[6] > 0.0);
        parts[2].state = first.states[2];
        let discharging = [[3, 7], [4, 6]];
        let next = measure(&parts, &discharging, Some(dt)).unwrap();
        assert!(
            (next.states[2].electrical - first.states[2].electrical * 10.0 / 11.0).abs() < 1e-9
        );
        assert!(next.currents[2] < 0.0);
    }

    #[test]
    fn probe_does_not_join_independent_references() {
        let parts = [
            part(PartKind::Dc, 5.0),
            part(PartKind::Dc, 9.0),
            part(PartKind::Open, 0.0),
        ];
        let reading = measure(&parts, &[[0, 6], [3, 7]], None).unwrap();
        assert_ne!(reading.reference_groups[6], reading.reference_groups[7]);
        assert_eq!(reading.volts[6], 5.0);
        assert_eq!(reading.volts[7], 9.0);
    }

    fn run(parts: &mut [Part], wires: &[[usize; 2]], duration: f64) -> Reading {
        let mut time = 0.0;
        let limit: f64 = 1.0 / 1200.0;
        let mut step = limit;
        loop {
            let (reading, elapsed, next) =
                advance(parts, wires, time, step.min(duration - time)).unwrap();
            for (part, state) in parts.iter_mut().zip(&reading.states) {
                part.state = *state;
            }
            time += elapsed;
            if duration - time <= duration * 1e-12 {
                return reading;
            }
            step = next.min(limit);
        }
    }

    #[test]
    fn fast_rc_matches_charge_and_discharge_exponentials() {
        let mut parts = [
            part(PartKind::Dc, 5.0),
            part(PartKind::Resistance, 100.0),
            part(PartKind::Capacitor, 1.0),
        ];
        let tau = 1e-4;
        let charging = [[0, 3], [4, 6], [7, 1]];
        let charged = run(&mut parts, &charging, tau).states[2].electrical;
        assert!(
            (charged - 5.0 * (1.0 - (-1.0_f64).exp())).abs() < 0.001,
            "{charged}"
        );
        let discharging = [[3, 7], [4, 6]];
        let discharged = run(&mut parts, &discharging, tau).states[2].electrical;
        assert!(
            (discharged - charged * (-1.0_f64).exp()).abs() < 0.001,
            "{discharged}"
        );
    }

    #[test]
    fn lc_ringdown_matches_phase_and_amplitude() {
        let mut parts = [
            part(PartKind::Inductor, 10.0),
            part(PartKind::Capacitor, 10.0),
        ];
        parts[1].state.electrical = 5.0;
        let wires = [[0, 3], [1, 4]];
        let t = 1.0 / 600.0;
        let alpha: f64 = 0.1 / (2.0 * 0.01);
        let omega = (1.0 / (0.01 * 1e-5) - alpha.powi(2)).sqrt();
        for multiple in 1..=12 {
            let actual = run(&mut parts, &wires, t).states[1].electrical;
            let time = t * f64::from(multiple);
            let expected = 5.0
                * (-alpha * time).exp()
                * ((omega * time).cos() + alpha / omega * (omega * time).sin());
            assert!(
                (actual - expected).abs() < 0.015,
                "{time}: {actual} vs {expected}"
            );
        }
    }

    #[test]
    fn motor_back_emf_reduces_current_and_rotor_coasts() {
        let mut parts = [part(PartKind::Dc, 5.0), part(PartKind::Motor, 10.0)];
        parts[1].motor = Motor {
            inductance: 0.005,
            inertia: 1e-6,
            constant: 0.01,
            damping: 2e-6,
            load: 0.0,
        };
        let powered = [[0, 3], [1, 4]];
        let starting = run(&mut parts, &powered, 0.003);
        assert!(starting.currents[1] > 0.45);
        let steady = run(&mut parts, &powered, 2.0);
        let expected_speed = 5.0 / (0.01 + 10.0 * 2e-6 / 0.01);
        assert!((steady.states[1].speed - expected_speed).abs() < 0.001);
        assert!((steady.currents[1] - 2e-6 * expected_speed / 0.01).abs() < 1e-6);
        let coasting = run(&mut parts, &[], 0.5);
        let expected_coast = expected_speed * (-1.0_f64).exp();
        assert!((coasting.states[1].speed - expected_coast).abs() < 0.001);
        assert!(coasting.currents[1].abs() < 1e-9);
        assert!((coasting.volts[3] - coasting.volts[4] - 0.01 * expected_coast).abs() < 1e-5);
    }

    #[test]
    fn load_torque_increases_current_and_reduces_speed() {
        let mut parts = [part(PartKind::Dc, 5.0), part(PartKind::Motor, 10.0)];
        parts[1].motor = Motor {
            inductance: 0.005,
            inertia: 1e-6,
            constant: 0.01,
            damping: 2e-6,
            load: 0.001,
        };
        let loaded = run(&mut parts, &[[0, 3], [1, 4]], 2.0);
        let expected_speed = (5.0 - 10.0 * 0.001 / 0.01) / (0.01 + 10.0 * 2e-6 / 0.01);
        assert!((loaded.states[1].speed - expected_speed).abs() < 0.001);
        assert!((loaded.currents[1] - (2e-6 * expected_speed + 0.001) / 0.01).abs() < 1e-6);
    }
}
