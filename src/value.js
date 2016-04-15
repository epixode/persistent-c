
export const integerValue = function (number) {
  if (typeof number === 'string') {
    number = parseInt(number);
  }
  return ['integer', number | 0];
};

export const floatingValue = function (number) {
  if (typeof number === 'string') {
    number = parseFloat(number);
  }
  return ['floating', number];
};

const evalIntegerBinaryOperation = function (op, v1, v2) {
  let r;
  switch (op) {
    case 'Add': case 'AddAssign': r = v1 + v2;  break;
    case 'Sub': case 'SubAssign': r = v1 - v2;  break;
    case 'Mul': case 'MulAssign': r = v1 * v2;  break;
    case 'Div': case 'DivAssign': r = v1 / v2;  break;
    // TODO: check Rem results on negative values
    case 'Rem': case 'RemAssign': r = v1 % v2;  break;
    case 'And': case 'AndAssign': r = v1 & v2;  break;
    case 'Or':  case 'OrAssign':  r = v1 | v2;  break;
    case 'Xor': case 'XorAssign': r = v1 ^ v2;  break;
    case 'Shl': case 'ShlAssign': r = v1 << v2; break;
    case 'Shr': case 'ShrAssign': r = v1 >> v2; break;
    case 'EQ':  r = v1 === v2; break;
    case 'NE':  r = v1 !== v2; break;
    case 'LT':  r = v1 < v2;   break;
    case 'LE':  r = v1 <= v2;  break;
    case 'GT':  r = v1 > v2;   break;
    case 'GE':  r = v1 >= v2;  break;
  }
  return integerValue(r);
};

const evalFloatingBinaryOperation = function (op, v1, v2) {
  let r;
  switch (op) {
    case 'Add': case 'AddAssign': r = v1 + v2;  break;
    case 'Sub': case 'SubAssign': r = v1 - v2;  break;
    case 'Mul': case 'MulAssign': r = v1 * v2;  break;
    case 'Div': case 'DivAssign': r = v1 / v2;  break;
    case 'EQ':  return integerValue(v1 === v2);
    case 'NE':  return integerValue(v1 !== v2);
    case 'LT':  return integerValue(v1  <  v2);
    case 'LE':  return integerValue(v1 <=  v2);
    case 'GT':  return integerValue(v1  >  v2);
    case 'GE':  return integerValue(v1 >=  v2);
  }
  return floatingValue(r);
};

export const evalBinaryOperation = function (op, lhs, rhs) {
  if (lhs[0] === 'integer' && rhs[0] === 'integer') {
    return evalIntegerBinaryOperation(op, lhs[1], rhs[1]);
  }
  if (lhs[0] === 'floating' && rhs[0] === 'floating') {
    return evalFloatingBinaryOperation(op, lhs[1], rhs[1]);
  }
  return ['expr', op, lhs, rhs];
};

export const evalUnaryOperation = function (opcode, operand) {
  if (operand[0] === 'integer') {
    switch (opcode) {
      case 'Plus': return operand;
      case 'Minus': return integerValue(-operand[1]);
      case 'LNot': return integerValue(operand[1] === 0);
      case 'Not': return integerValue(~operand[1]);
    }
  }
  if (operand[0] === 'floating') {
    switch (opcode) {
      case 'Plus': return operand;
      case 'Minus': return floatingValue(-operand[1]);
    }
  }
  return ['expr', opcode, operand];
};

export const unboxAsInteger = function (value) {
  if (value[0] === 'integer')
    return value[1];
  if (value[0] === 'floating')
    return value[1] | 0;
  // TODO: handle pointers
  console.log('unboxAsInteger not implemented for', value);
  throw 'unboxAsInteger';
};

export const evalCast = function (ty, value) {
  if (ty[0] === 'builtin') {
    if (ty[1] === 'char' || ty[1] === 'unsigned char')
      return integerValue(unboxAsInteger(value) & 0xff);
    if (ty[1] === 'short' || ty[1] === 'unsigned short')
      return integerValue(unboxAsInteger(value) & 0xffff);
    if (ty[1] === 'int' || ty[1] === 'unsigned int')
      return integerValue(unboxAsInteger(value) & 0xffffffff);
    if (ty[1] === 'long' || ty[1] === 'unsigned long')
      return integerValue(unboxAsInteger(value) & 0xffffffff);
    if (ty[1] === 'float' || ty[1] === 'double') {
      if (value[0] === 'integer' || value[0] === 'floating') {
        return floatingValue(value[1]);
      }
    }
  }
  if (ty[0] === 'pointer') {
    // XXX string is temporary, it should just be a pointer
    if (/^(pointer|function|builtin|string)$/.test(value[0]))
      return value;
  }
  console.log("evalCast not implemented for", ty, value);
  throw 'evalCast';
};
