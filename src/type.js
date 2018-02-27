
export const Type = function (kind, size) {
  this.kind = kind;
  this.size = size;
}

export const functionType = function (resultType, paramDecls) {
  const type = new Type('function', 0);
  type.result = resultType;
  type.params = paramDecls;  // [{name,type}]
  return type;
};

function getPointerSize (pointeeType) {
  if (pointeeType.kind === 'function') {
    return 2;
  }
  return 4;
}

export const pointerType = function (pointeeType) {
  const pointerSize = getPointerSize(pointeeType);
  const type = new Type('pointer', pointerSize);
  type.pointee = pointeeType;
  return type;
};

export const arrayType = function (elemType, elemCount) {
  const type = new Type('array', elemCount && elemType.size * elemCount.toInteger());
  type.elem = elemType;
  type.count = elemCount;
  type.composite = true;
  return type;
};

export function resolveIncompleteArrayType (type, dims) {
  function resolve (type, rank) {
    if (rank === dims.length) {
      return type;
    } else {
      const elemType = resolve(type.elem, rank + 1);
      const elemCount = new IntegralValue(builtinTypes['unsigned int'], type.count || dims[rank]);
      return arrayType(elemType, elemCount);
    }
  }
  return resolve(type, 0);
}

export const decayedType = function (origType) {
  const pointerSize = getPointerSize(origType);
  const type = new Type('pointer', pointerSize);
  type.orig = origType;
  if (origType.kind === 'array') {
    // Decayed array type.
    type.pointee = origType.elem;
  } else {
    // Decayed function type.
    type.pointee = origType;
  }
  return type;
};

export const recordType = function (name, fields) {
  const {size, fieldMap} = layoutRecord(fields);
  const type = new Type('record', size);
  type.name = name;
  type.fields = fields.map(field => field.name);
  type.fieldMap = fieldMap;
  type.composite = true;
  return type;
};

export const forwardRecordType = function (name) {
  const type = new Type('record', 0);
  type.name = name;
  type.forward = true;
  return type;
};

export const builtinTypes = {};
const addBuiltinType = function (repr, size) {
  const type = new Type('builtin', size);
  type.repr = repr;
  builtinTypes[repr] = type;
};
addBuiltinType('void', 0);
addBuiltinType('char', 1);
addBuiltinType('unsigned char', 1);
addBuiltinType('short', 2);
addBuiltinType('unsigned short', 2);
addBuiltinType('int', 4);
addBuiltinType('unsigned int', 4);
addBuiltinType('long', 4);
addBuiltinType('unsigned long', 4);
addBuiltinType('long long', 8);
addBuiltinType('unsigned long long', 8);
addBuiltinType('float', 4);
addBuiltinType('double', 8);

export const lubType = function (t1, t2) {
  // This function should compute least-upper-bound of (t1, t2), but it is
  // probably actually always used with t1 == t2.
  return t1;
};

function layoutRecord (fields) {
  let size = 0;
  const fieldMap = {};
  fields.forEach(function (field) {
    const {name, type} = field;
    fieldMap[name] = {offset: size, type};
    size += type.size;
  });
  return {size, fieldMap};
}

export function closeTypeDecls (core) {
  const {recordDecls} = core;
  console.log('closing', recordDecls);
  for (let recordName of recordDecls.keys()) {
    const {fields, fieldMap} = recordDecls.get(recordName);
    for (let fieldName of fields) {
      const type = fieldMap[fieldName].type;
      if (type.forward && type.kind === 'record') {
        Object.assign(type, recordDecls.get(type.name));
      }
    }
  }
}
