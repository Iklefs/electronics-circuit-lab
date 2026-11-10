pub const UNKNOWN: i8 = -1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gate {
    Input,
    Low,
    High,
    Output,
    Not,
    And,
    Nand,
    Or,
    Nor,
    Xor,
    Xnor,
}

impl Gate {
    pub fn from_code(code: usize) -> Option<Self> {
        use Gate::*;
        [Input, Low, High, Output, Not, And, Nand, Or, Nor, Xor, Xnor]
            .get(code)
            .copied()
    }

    pub fn inputs(self) -> usize {
        match self {
            Self::Input | Self::Low | Self::High => 0,
            Self::Output | Self::Not => 1,
            _ => 2,
        }
    }

    pub fn has_output(self) -> bool {
        self != Self::Output
    }

    fn evaluate(self, input: i8, a: i8, b: i8) -> i8 {
        use Gate::*;
        let invert = |value| if value == UNKNOWN { UNKNOWN } else { 1 - value };
        let and = || {
            if a == 0 || b == 0 {
                0
            } else if a == 1 && b == 1 {
                1
            } else {
                UNKNOWN
            }
        };
        let or = || {
            if a == 1 || b == 1 {
                1
            } else if a == 0 && b == 0 {
                0
            } else {
                UNKNOWN
            }
        };
        let xor = || {
            if a == UNKNOWN || b == UNKNOWN {
                UNKNOWN
            } else {
                a ^ b
            }
        };
        match self {
            Input => input,
            Low => 0,
            High => 1,
            Output => UNKNOWN,
            Not => invert(a),
            And => and(),
            Nand => invert(and()),
            Or => or(),
            Nor => invert(or()),
            Xor => xor(),
            Xnor => invert(xor()),
        }
    }
}

pub fn evaluate(parts: &[(Gate, i8)], wires: &[[usize; 2]]) -> Vec<i8> {
    let mut values = vec![UNKNOWN; parts.len() * 3];
    // Known values can propagate even with an open input (for example 0 AND X).
    // Unresolved feedback stays unknown.
    for _ in 0..=parts.len() {
        let mut changed = false;
        for &[source, target] in wires {
            changed |= values[target] != values[source];
            values[target] = values[source];
        }
        for (index, &(gate, input)) in parts.iter().enumerate() {
            let base = index * 3;
            let value = gate.evaluate(input, values[base], values[base + 1]);
            changed |= values[base + 2] != value;
            values[base + 2] = value;
        }
        if !changed {
            break;
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_adder_and_fan_out() {
        let wires = [[2, 6], [5, 7], [2, 9], [5, 10], [8, 12], [11, 15]];
        for a in 0..=1 {
            for b in 0..=1 {
                let parts = [
                    (Gate::Input, a),
                    (Gate::Input, b),
                    (Gate::Xor, 0),
                    (Gate::And, 0),
                    (Gate::Output, 0),
                    (Gate::Output, 0),
                ];
                let values = evaluate(&parts, &wires);
                assert_eq!(values[12], a ^ b);
                assert_eq!(values[15], a & b);
            }
        }
    }

    #[test]
    fn open_inputs_and_feedback_are_unknown_unless_determined() {
        assert_eq!(evaluate(&[(Gate::Not, 0)], &[[2, 0]])[2], UNKNOWN);
        let parts = [(Gate::Low, 0), (Gate::And, 0), (Gate::Or, 0)];
        let values = evaluate(&parts, &[[2, 3], [2, 6]]);
        assert_eq!(values[5], 0);
        assert_eq!(values[8], UNKNOWN);
    }
}
