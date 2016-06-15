
export const pointerSize = 4;

export const Type = function (kind, size) {
  this.kind = kind;
  this.size = size;
}

export const functionType = function (resultType, paramDecls) {
  const type = new Type('function', pointerSize);
  type.result = resultType;
  type.params = paramDecls;  // [{name,type}]
  type.toString = function () {
    const paramStrs = this.params.map(d => `${d.type} ${d.name}`);
    return `${this.result}(*)(${paramStrs.join(', ')})`;
  };
  return type;
};

export const pointerType = function (pointeeType) {
  const type = new Type('pointer', pointerSize);
  type.pointee = pointeeType;
  type.toString = function () {
    return `(${this.pointee})*`;
  };
  return type;
};

export const arrayType = function (elemType, elemCount) {
  const type = new Type('array', elemCount && elemType.size * elemCount.toInteger());
  type.elem = elemType;
  type.count = elemCount;
  type.toString = function () {
    return `(${this.elem})[${this.count}]`;
  };
  return type;
};

export const scalarTypes = {};
const addScalarType = function (repr, size) {
  const type = new Type('scalar', size);
  type.repr = repr;
  type.toString = function () { return this.repr; }
  scalarTypes[repr] = type;
};
addScalarType('char', 1);
addScalarType('unsigned char', 1);
addScalarType('short', 2);
addScalarType('unsigned short', 2);
addScalarType('int', 4);
addScalarType('unsigned int', 4);
addScalarType('long', 4);
addScalarType('unsigned long', 4);
addScalarType('long long', 8);
addScalarType('unsigned long long', 8);
addScalarType('float', 4);
addScalarType('double', 8);

export const lubType = function (t1, t2) {
  // This function should compute least-upper-bound of (t1, t2), but it is
  // probably actually always used with t1 == t2.
  return t1;
};
