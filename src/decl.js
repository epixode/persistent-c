
import {builtinTypes, arrayType, arraySize, arrayGroundType} from './type';
import {IntegralValue, ArrayValue, zeroAtType} from './value';

export const finalizeVarDecl = function (type, init) {
  if (init && type.kind === 'array') {
    // Special considerations for array types:
    // - the initialization list is a (javascript array of)+ values;
    // - an incomplete array type has an undefined element count, which is
    //   filled in using the length of the initialization list.
    const dims = arraySize(init);
    type = resolveArraySize(type, dims, 0);
    const nullElem = zeroAtType(arrayGroundType(type));
    init = buildArrayInitValue(type, init, nullElem);
  }
  return {type, init};
};

const resolveArraySize = function (type, dims, rank) {
  if (rank === dims.length) {
    return type;
  }
  const elemType = resolveArraySize(type.elem, dims, rank + 1);
  const elemCount = new IntegralValue(builtinTypes['unsigned int'], type.count || dims[rank]);
  return arrayType(elemType, elemCount);
};

const buildArrayInitValue = function (type, init, nullElem) {
  if (type.kind !== 'array') {
    return init || nullElem;
  }
  const elements = [];
  const elemCount = type.count.toInteger();
  for (let i = 0; i < elemCount; i += 1) {
    elements.push(buildArrayInitValue(type.elem, init && init[i], nullElem));
  }
  return new ArrayValue(type, elements);
};
