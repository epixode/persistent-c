
import Immutable from 'immutable';
import {packValue, unpackValue} from './value';

const littleEndian = false;

export const allocate = function (size) {
  return Immutable.List(Array(size).fill(0));
};

export const writeValue = function (memory, ref, value) {
  if (value === undefined)
    return memory;  // XXX
  // XXX assert(ref instanceof PointerValue)
  // XXX assert(typeEquals(ref.type.pointee, value.type))
  const address = ref.address;
  const nbytes = value.type.size;
  const view = new DataView(new ArrayBuffer(nbytes));
  packValue(view, 0, value, littleEndian);
  for (let offset = 0; offset < nbytes; offset += 1) {
    memory = memory.set(address + offset, view.getUint8(offset));
  }
  return memory;
};

export const readValue = function (memory, ref) {
  // XXX assert(ref instanceof PointerValue)
  const {type, address} = ref;
  const nbytes = type.pointee.size;
  const view = new DataView(new ArrayBuffer(nbytes));
  for (let offset = 0; offset < nbytes; offset += 1) {
    view.setUint8(offset, memory.get(address + offset));
  }
  return unpackValue(view, 0, type.pointee, littleEndian);
};

export const readString = function (memory, ref) {
  const {address} = ref;
  let endAddress = address;
  while (endAddress < memory.size && memory.get(endAddress) !== 0) {
    endAddress += 1;
  }
  const charCount = endAddress - address;
  const view = new DataView(new ArrayBuffer(charCount));
  for (let offset = 0; offset < charCount; offset += 1) {
    view.setInt8(offset, memory.get(address + offset));
  }
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(view);
};
