
import {pointerType, arrayType, builtinTypes} from './type';
import {PointerValue, ArrayValue, RecordValue, IntegralValue, zeroAtType} from './value';
import {readValue} from './memory';

export const finalizeVarDecl = function (core, type, init) {
  if (init && type.kind === 'array') {
    /* Resolve array dimensions using the initialization list. */
    const dims = arraySize(init);
    type = resolveIncompleteArrayType(type, dims);
  }
  return {type, init: buildInitValue(core, type, init)};
};

function resolveIncompleteArrayType (type, dims) {
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

function arraySize (init) {
  const result = [];
  while (Array.isArray(init)) {
    result.push(init.length);
    init = init[0];
  }
  return result;
}

function buildInitValue (core, type, init) {
  if (type.kind === 'array') {
    return buildArrayInitValue(core, type, init);
  }
  if (type.kind === 'record') {
    return buildRecordInitValue(core, type, init);
  }
  return init || zeroAtType(type);
}

function buildArrayInitValue (core, type, init) {
  const elements = [];
  const elemCount = type.count.toInteger();
  if (Array.isArray(init)) {
    for (let i = 0; i < elemCount; i += 1) {
      elements.push(buildInitValue(core, type.elem, init && init[i]));
    }
  } else if (init instanceof PointerValue) {
    /* Initialization from pointer value (string literal) */
    const refType = pointerType(type.elem);
    const ref = new PointerValue(refType, init.address);
    /* init is a PointerValue with a definite-sized array type */
    const count = Math.min(elemCount, init.type.size);
    for (let i = 0; i < count; i += 1) {
      elements.push(readValue(core, ref));
      ref.address += type.elem.size;
    }
  } else {
    console.warn("unsupported array init", init);
  }
  return new ArrayValue(type, elements);
}

function buildRecordInitValue (core, type, init) {
  const {fields, fieldMap} = type;
  const props = {};
  const fieldCount = fields.length;
  for (let fieldPos = 0; fieldPos < fieldCount; fieldPos += 1) {
    const fieldInit = init && init[fieldPos];
    if (fieldInit) {
      const name = fields[fieldPos];
      const {type: fieldType} = fieldMap[name];
      props[name] = buildInitValue(core, fieldType, fieldInit);
    }
  }
  return new RecordValue(type, props);
}
