
import {pointerType, resolveIncompleteArrayType} from './type';
import {PointerValue, ArrayValue, RecordValue, zeroAtType} from './value';
import {readValue} from './memory';

export const finalizeVarDecl = function (core, type, init) {
  if (init && type.kind === 'array') {
    /* Resolve array dimensions using the initialization list. */
    const dims = arraySize(init);
    type = resolveIncompleteArrayType(type, dims);
  }
  return {type, init: buildInitValue(core, type, init)};
};

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
    for (let i = 0; i < elemCount; i += 1) {
      elements.push(readValue(core, ref));
      ref.address += type.elem.size;
    }
  } else {
    console.warn("unsupported array init", init);
  }
  return new ArrayValue(type, elements);
}
