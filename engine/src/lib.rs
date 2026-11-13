mod analog;
mod logic;

use analog::{Error, Motor, Part, PartKind, State, PIN_STRIDE};
use logic::Gate;

const MAX_PARTS: usize = 256;
const MAX_WIRES: usize = 512;
const PART_STRIDE: usize = 10;
const WIRE_INPUT: usize = MAX_PARTS * PART_STRIDE;
const VOLT_OUTPUT: usize = WIRE_INPUT + MAX_WIRES * 2;
const CURRENT_OUTPUT: usize = VOLT_OUTPUT + MAX_PARTS * PIN_STRIDE;
const HISTORY_OUTPUT: usize = CURRENT_OUTPUT + MAX_PARTS;
const WIRE_OUTPUT: usize = HISTORY_OUTPUT + MAX_PARTS * 2;
const REFERENCE_OUTPUT: usize = WIRE_OUTPUT + MAX_WIRES;
const STEP_OUTPUT: usize = REFERENCE_OUTPUT + MAX_PARTS * PIN_STRIDE;
const BUFFER_SIZE: usize = STEP_OUTPUT + 2;

// The browser writes into this buffer and calls one synchronous export at a time.
// The WASM module has no imports or threads, so these calls cannot re-enter.
static mut BUFFER: [f64; BUFFER_SIZE] = [0.0; BUFFER_SIZE];

#[no_mangle]
pub extern "C" fn engine_buffer() -> *mut f64 {
    std::ptr::addr_of_mut!(BUFFER).cast()
}

#[no_mangle]
pub extern "C" fn rc_time_constant(resistance_kohm: f64, capacitance_uf: f64) -> f64 {
    resistance_kohm * capacitance_uf / 1000.0
}

#[no_mangle]
pub extern "C" fn rc_voltage(voltage: f64, time: f64, tau: f64, charging: u32) -> f64 {
    let exponent = -time / tau;
    voltage
        * if charging != 0 {
            -exponent.exp_m1()
        } else {
            exponent.exp()
        }
}

fn parse_wires(
    buffer: &[f64],
    count: usize,
    valid: impl Fn(usize, usize) -> bool,
) -> Option<Vec<[usize; 2]>> {
    buffer[WIRE_INPUT..WIRE_INPUT + count * 2]
        .chunks_exact(2)
        .map(|row| {
            let (a, b) = (row[0] as usize, row[1] as usize);
            (row[0] == a as f64 && row[1] == b as f64 && valid(a, b)).then_some([a, b])
        })
        .collect()
}

#[no_mangle]
pub extern "C" fn measure_analog(
    part_count: usize,
    wire_count: usize,
    time: f64,
    step: f64,
) -> u32 {
    if part_count > MAX_PARTS
        || wire_count > MAX_WIRES
        || !time.is_finite()
        || !step.is_finite()
        || step < 0.0
    {
        return 5;
    }
    let buffer = unsafe { std::slice::from_raw_parts_mut(engine_buffer(), BUFFER_SIZE) };
    let parts: Option<Vec<_>> = buffer[..part_count * PART_STRIDE]
        .chunks_exact(PART_STRIDE)
        .map(|row| {
            let kind = PartKind::from_code(row[0] as usize)?;
            let pins = match kind {
                PartKind::Ground => 1,
                PartKind::Spdt | PartKind::Pot => 3,
                _ => 2,
            };
            if kind == PartKind::Motor
                && [row[1], row[5], row[6], row[7], row[8]]
                    .iter()
                    .any(|value| *value <= 0.0)
            {
                return None;
            }
            row.iter().all(|value| value.is_finite()).then_some(Part {
                kind,
                pins,
                value: row[1],
                frequency: row[2],
                state: State {
                    electrical: row[3],
                    speed: row[4],
                },
                motor: Motor {
                    inductance: row[5],
                    inertia: row[6],
                    constant: row[7],
                    damping: row[8],
                    load: row[9],
                },
            })
        })
        .collect();
    let Some(parts) = parts else { return 5 };
    let pin_exists = |pin: usize| {
        parts
            .get(pin / PIN_STRIDE)
            .is_some_and(|part| pin % PIN_STRIDE < part.pins)
    };
    let Some(wires) = parse_wires(buffer, wire_count, |a, b| pin_exists(a) && pin_exists(b)) else {
        return 5;
    };
    let result = if step > 0.0 {
        analog::advance(&parts, &wires, time, step)
    } else {
        analog::measure(&parts, &wires, None).map(|reading| (reading, 0.0, 0.0))
    };
    let (reading, actual_step, next_step) = match result {
        Ok(result) => result,
        Err(Error::OpenCurrentSource) => return 2,
        Err(Error::Singular) => return 3,
        Err(Error::NonConvergent) => return 4,
        Err(Error::StepTooSmall) => return 6,
    };
    let pin_count = part_count * PIN_STRIDE;
    buffer[VOLT_OUTPUT..VOLT_OUTPUT + pin_count].copy_from_slice(&reading.volts[..pin_count]);
    buffer[CURRENT_OUTPUT..CURRENT_OUTPUT + part_count].copy_from_slice(&reading.currents);
    for (index, state) in reading.states.iter().enumerate() {
        let offset = HISTORY_OUTPUT + index * 2;
        buffer[offset] = state.electrical;
        buffer[offset + 1] = state.speed;
    }
    buffer[WIRE_OUTPUT..WIRE_OUTPUT + wire_count].copy_from_slice(&reading.wire_currents);
    buffer[REFERENCE_OUTPUT..REFERENCE_OUTPUT + pin_count]
        .copy_from_slice(&reading.reference_groups[..pin_count]);
    buffer[STEP_OUTPUT] = actual_step;
    buffer[STEP_OUTPUT + 1] = next_step;
    0
}

#[no_mangle]
pub extern "C" fn measure_logic(part_count: usize, wire_count: usize) -> u32 {
    if part_count > MAX_PARTS || wire_count > MAX_WIRES {
        return 5;
    }
    let buffer = unsafe { std::slice::from_raw_parts_mut(engine_buffer(), BUFFER_SIZE) };
    let parts: Option<Vec<_>> = buffer[..part_count * PART_STRIDE]
        .chunks_exact(PART_STRIDE)
        .map(|row| {
            let gate = Gate::from_code(row[0] as usize)?;
            Some((gate, if row[1] == 1.0 { 1 } else { 0 }))
        })
        .collect();
    let Some(parts) = parts else { return 5 };
    let mut driven = [false; MAX_PARTS * PIN_STRIDE];
    let Some(wires) = parse_wires(buffer, wire_count, |a, b| {
        parts
            .get(a / PIN_STRIDE)
            .is_some_and(|(gate, _)| a % PIN_STRIDE == 2 && gate.has_output())
            && parts
                .get(b / PIN_STRIDE)
                .is_some_and(|(gate, _)| b % PIN_STRIDE < gate.inputs())
    }) else {
        return 5;
    };
    for &[_, pin] in &wires {
        if driven[pin] {
            return 5;
        }
        driven[pin] = true;
    }
    let values = logic::evaluate(&parts, &wires);
    for (index, value) in values.into_iter().enumerate() {
        buffer[VOLT_OUTPUT + index] = f64::from(value);
    }
    0
}
