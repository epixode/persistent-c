
import Immutable from 'immutable';
import {packValue, unpackValue, badFunction} from './value';
import {TextDecoder} from 'text-encoding-utf-8';

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

export const readValue = function (core, ref) {
  // XXX assert(ref instanceof PointerValue)
  const {memory} = core;
  const {type, address} = ref;
  const nbytes = type.pointee.size;
  const view = new DataView(new ArrayBuffer(nbytes));
  for (let offset = 0; offset < nbytes; offset += 1) {
    view.setUint8(offset, memory.get(address + offset));
  }
  return unpackValue(view, 0, type.pointee, littleEndian, core);
};

export const strlen = function (memory, ref, maxBytes) {
  const {address} = ref;
  const limit = (maxBytes === undefined ? memory.size : Math.min(memory.size, address + maxBytes)) - 1;
  let endAddress = address;
  while (endAddress < limit && memory.get(endAddress) !== 0) {
    endAddress += 1;
  }
  return endAddress - address;
};

const readBytes = function (view, byteCount, memory, ref) {
  for (let offset = 0; offset < byteCount; offset += 1) {
    view.setInt8(offset, memory.get(ref.address + offset));
  }
};

export const readString = function (memory, ref, maxBytes) {
  const byteCount = strlen(memory, ref, maxBytes);
  const view = new DataView(new ArrayBuffer(byteCount));
  readBytes(view, byteCount, memory, ref);
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(view);
};
