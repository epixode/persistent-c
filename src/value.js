
// TextEncoder shim for older browsers and Safari.
import {TextEncoder} from 'text-encoding-utf-8';

import {scalarTypes, arrayType, lubType} from './type';

export function IntegralValue (type, number) {
  this.type = type;
  if (/^unsigned/.test(this.type.repr)) {
    this.number = number >>> 0;
  } else {
    this.number = number | 0;
  }
};
IntegralValue.prototype.toString = function () {
  if (this.type.repr === 'char') {
    if (this.number >= 32 && this.number < 128) {
      switch (this.number) {
        case 39: return '\\\'';
        case 92: return '\\\\';
        default: return `'${String.fromCharCode(this.number)}'`;
      }
    } else {
      switch (this.number) {
        case 0: return '\\0';
        case 8: return '\\t';
        case 10: return '\\r';
        case 13: return '\\n';
        default: {
          const n = this.number + (this.number >= 0 ? 0 : 256);
          return `'\\x${n.toString(16)}'`;
        }
      }
    }
  } else {
    return this.number.toString();
  }
};
IntegralValue.prototype.toInteger = function () {
  return this.number;
};
IntegralValue.prototype.toBool = function () {
  return 0 !== this.number;
};
IntegralValue.prototype.pack = function (view, offset, littleEndian) {
  switch (this.type.repr) {
    case 'char':
      view.setInt8(offset, this.number);
      break;
    case 'unsigned char':
      view.setUint8(offset, this.number);
      break;
    case 'short':
      view.setInt16(offset, this.number, littleEndian);
      break;
    case 'unsigned short':
      view.setUint16(offset, this.number, littleEndian);
      break;
    case 'int':
    case 'long':
      view.setInt32(offset, this.number, littleEndian);
      break;
    case 'unsigned int':
    case 'unsigned long':
      view.setUint32(offset, this.number, littleEndian);
      break;
    default:
      throw new Error(`cannot pack integral value ${this.type.repr}`);
  }
};

export function FloatingValue (type, number) {
  this.type = type;
  this.number = type.size === 4 ? Math.fround(number) : number;
};
FloatingValue.prototype.toString = function () {
  let str = this.number.toFixed(6);
  // Trim the trailing zeros, and the decimal point if there are no digits
  // to its right.
  str = str.replace(/(\.[0-9]*?)0+$/, function (m, n) {
    return n === '.' ? '' : n;
  });
  return str;
};
FloatingValue.prototype.toInteger = function () {
  return this.number | 0;
};
FloatingValue.prototype.toBool = function () {
  return 0 !== this.number;
};
FloatingValue.prototype.pack = function (view, offset, littleEndian) {
  switch (this.type.repr) {
    case 'float':
      view.setFloat32(offset, this.number, littleEndian);
      break;
    case 'double':
      view.setFloat64(offset, this.number, littleEndian);
      break;
    default:
      throw new Error(`cannot pack floating value ${this.type.repr}`);
  }
};

export function PointerValue (type, address) {
  this.type = type;
  this.address = address | 0;
};
PointerValue.prototype.toString = function () {
  return `0x${this.address.toString(16)}`;
};
PointerValue.prototype.toInteger = function () {
  return this.address;
};
PointerValue.prototype.toBool = function () {
  return 0 !== this.address;
};
PointerValue.prototype.pack = function (view, offset, littleEndian) {
  view.setUint32(offset, this.address, littleEndian);
};

export function ArrayValue (type, elements) {
  this.type = type;
  this.elements = elements;
};
ArrayValue.prototype.toString = function () {
  return `array`;
};
ArrayValue.prototype.pack = function (view, offset, littleEndian) {
  const elemSize = this.type.elem.size;
  this.elements.forEach(function (elem, index) {
    packValue(view, offset + index * elemSize, elem, littleEndian);
  });
};

export function FunctionValue (decl) {
  this.decl = decl;
  this.name = decl[2][0][1].identifier;
};

export function BuiltinValue (name, func) {
  this.name = name;
  this.func = func;
};

export const packValue = function (view, offset, value, littleEndian) {
  value.pack(view, offset, littleEndian);
};

export const unpackValue = function (view, offset, type, littleEndian) {
  switch (type.kind) {
    case 'scalar':
      switch (type.repr) {
        case 'char':
          return new IntegralValue(type, view.getInt8(offset));
        case 'unsigned char':
          return new IntegralValue(type, view.getUint8(offset));
        case 'short':
          return new IntegralValue(type, view.getInt16(offset, littleEndian));
        case 'unsigned short':
          return new IntegralValue(type, view.getUint16(offset, littleEndian));
        case 'int':
        case 'long':
          return new IntegralValue(type, view.getInt32(offset, littleEndian));
        case 'unsigned int':
        case 'unsigned long':
          return new IntegralValue(type, view.getUint32(offset, littleEndian));
        case 'float':
          return new FloatingValue(type, view.getFloat32(offset, littleEndian));
        case 'double':
          return new FloatingValue(type, view.getFloat64(offset, littleEndian));
        default:
          throw new Error(`unpack scalar ${type.repr}`);
      }
    case 'array':
      {
        const elemType = type.elem;
        const elemSize = elemType.size;
        const elements = [];
        for (var index = 0; index < type.count; index++) {
          elements.push(unpackValue(view, offset + index * elemSize, elemType, littleEndian));
        }
        return new ArrayValue(type, elements);
      }
    case 'pointer':
      return new PointerValue(type, view.getUint32(offset, littleEndian));
    default:
      throw new Error(`not implemented: unpack ${type.kind}`);
  }
};

export const stringValue = function (string) {
  const encoder = new TextEncoder('utf-8');
  const bytesArray = encoder.encode(string);
  const charType = scalarTypes['char'];
  const charLen = bytesArray.length;
  const chars = [];
  for (let charPos = 0; charPos < charLen; charPos++) {
    chars.push(new IntegralValue(charType, bytesArray[charPos]));
  }
  chars.push(new IntegralValue(charType, 0));
  const lenValue = new IntegralValue(scalarTypes['int'], chars.length);
  return new ArrayValue(arrayType(charType, lenValue), chars);
};

const isRelational = function (op) {
  return /^(EQ|NE|LT|LE|GT|GE)$/.test(op);
};

const evalRelationalOperation = function (op, v1, v2) {
  switch (op) {
    case 'EQ':  return v1 === v2;
    case 'NE':  return v1 !== v2;
    case 'LT':  return v1 < v2;
    case 'LE':  return v1 <= v2;
    case 'GT':  return v1 > v2;
    case 'GE':  return v1 >= v2;
  }
};

const evalIntegerBinaryOperation = function (op, v1, v2) {
  switch (op) {
    case 'Add': case 'AddAssign': return v1 + v2;
    case 'Sub': case 'SubAssign': return v1 - v2;
    case 'Mul': case 'MulAssign': return v1 * v2;
    case 'Div': case 'DivAssign': return v1 / v2;
    case 'Rem': case 'RemAssign': return v1 % v2;
    case 'And': case 'AndAssign': return v1 & v2;
    case 'Or':  case 'OrAssign':  return v1 | v2;
    case 'Xor': case 'XorAssign': return v1 ^ v2;
    case 'Shl': case 'ShlAssign': return v1 << v2;
    case 'Shr': case 'ShrAssign': return v1 >> v2;
  }
};

const evalFloatingBinaryOperation = function (op, v1, v2) {
  switch (op) {
    case 'Add': case 'AddAssign': return v1 + v2;
    case 'Sub': case 'SubAssign': return v1 - v2;
    case 'Mul': case 'MulAssign': return v1 * v2;
    case 'Div': case 'DivAssign': return v1 / v2;
  }
};

export const evalBinaryOperation = function (opcode, lhs, rhs) {
  // Relational operators
  if (isRelational(opcode)) {
    const result = evalRelationalOperation(opcode, lhs.number, rhs.number);
    return new IntegralValue(scalarTypes['int'], result ? 1 : 0);
  }
  // Integer arithmetic
  if (lhs instanceof IntegralValue && rhs instanceof IntegralValue) {
    const result = evalIntegerBinaryOperation(opcode, lhs.number, rhs.number);
    return new IntegralValue(lubType(lhs.type, rhs.type), result);
  }
  // Float arithmetic
  if (lhs instanceof FloatingValue && rhs instanceof FloatingValue) {
    const result = evalFloatingBinaryOperation(opcode, lhs.number, rhs.number)
    return new FloatingValue(lubType(lhs.type, rhs.type), result);
  }
  // Pointer arithmetic
  if (lhs instanceof PointerValue && rhs instanceof IntegralValue) {
    if (opcode === 'Add') {
      const address = lhs.address + rhs.number * lhs.type.pointee.size;
      return new PointerValue(lhs.type, address);
    }
    if (opcode === 'Sub') {
      const address = lhs.address - rhs.number * lhs.type.pointee.size;
      return new PointerValue(lhs.type, address);
    }
  }
  if (lhs instanceof IntegralValue && rhs instanceof PointerValue) {
    if (opcode === 'Add') {
      const address = rhs.address + lhs.number * rhs.type.pointee.size;
      return new PointerValue(rhs.type, address);
    }
  }
  if (lhs instanceof PointerValue && rhs instanceof PointerValue) {
    if (opcode === 'Sub') {
      const offset = lhs.address - rhs.address;
      return new IntegralValue(scalarTypes['int'], offset);
    }
  }
  throw new Error(`not implemented: ${lhs} ${opcode} ${rhs}`);
};

export const evalUnaryOperation = function (opcode, operand) {
  if (operand instanceof IntegralValue) {
    switch (opcode) {
      case 'Plus': return operand;
      case 'Minus': return new IntegralValue(operand.type, -operand.number);
      case 'LNot': return new IntegralValue(scalarTypes['int'], !operand.toBool());
      case 'Not': return new IntegralValue(operand.type, ~operand.number);
    }
  }
  if (operand instanceof FloatingValue) {
    switch (opcode) {
      case 'Plus': return operand;
      case 'Minus': return new FloatingValue(operand.type, -operand.number);
    }
  }
  throw new Error(`not implemented: ${opcode} ${operand}`);
};

export const evalCast = function (type, operand) {
  if (type.kind === 'scalar') {
    if (/^(unsigned )?char$/.test(type.repr)) {
      return new IntegralValue(type, operand.toInteger() & 0xff);
    }
    if (/^(unsigned )?short$/.test(type.repr)) {
      return new IntegralValue(type, operand.toInteger() & 0xffff);
    }
    if (/^(unsigned )?(int|long)$/.test(type.repr)) {
      return new IntegralValue(type, operand.toInteger() & 0xffffffff);
    }
    if (/^(unsigned )?long long$/.test(type.repr)) {
      // XXX this only works up to 2^53, use npm:long
      return new IntegralValue(type, operand.toInteger());
    }
    if (type.repr === 'float') {
      if (operand instanceof FloatingValue || operand instanceof IntegralValue) {
        return new FloatingValue(type, operand.number)
      }
    }
    if (type.repr === 'double') {
      if (operand instanceof FloatingValue || operand instanceof IntegralValue) {
        return new FloatingValue(type, operand.number);
      }
    }
  }
  if (type.kind === 'pointer') {
    if (operand instanceof PointerValue) {
      return new PointerValue(type, operand.address);
    }
    if (operand instanceof IntegralValue) {
      return new PointerValue(type, operand.toInteger())
    }
    if (operand instanceof BuiltinValue || operand instanceof FunctionValue) {
      // XXX temporary cheat for non-addressable values.
      return operand;
    }
  }
  throw new Error(`not implemented: (${type})${operand}`);
};

export const evalPointerAdd = function (pointer, value) {
  const offset = value.toInteger() * pointer.type.pointee.size;
  return new PointerValue(pointer.type, pointer.address + offset);
};

export const zeroAtType = function (type) {
  if (type.kind === 'pointer') {
    return new PointerValue(type, 0);
  }
  if (type.kind === 'scalar') {
    switch (type.repr) {
      case 'char':
      case 'unsigned char':
      case 'short':
      case 'unsigned short':
      case 'int':
      case 'unsigned int':
      case 'long':
      case 'unsigned long':
      case 'long long':
      case 'unsigned long long':
        return new IntegralValue(type, 0);
      case 'float':
      case 'double':
        return new FloatingValue(type, 0);
    }
  }
  throw new Error(`undefined zero at type ${type.kind}`);
};
