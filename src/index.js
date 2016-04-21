
import Immutable from 'immutable';

import {allocate, readValue, writeValue} from './memory';
import {pointerType} from './type';
import {PointerValue} from './value';
import {getStep} from './step';
import {applyEffect} from './effects';

export {pointerType} from './type';
export {IntegralValue, FloatingValue, PointerValue} from './value';
export {readValue} from './memory';
export {getStep} from './step';
export {defaultEffects} from './effects';

export const start = function (context) {
  const {decls, builtins} = context;

  // Built the map of global variables.
  // The 'main' function is detected and currentNode is set to the body
  // of that function.
  let currentNode = null;
  const globalMap = {};
  // const intFunc = functionType(scalarTypes['int'], []);
  decls.forEach(function (node) {
    if (node[0] === 'FunctionDecl') {
      const name = node[2][0][1].identifier;
      // XXX: evaluate the types!
      if (builtins && name in builtins) {
        globalMap[name] = {name, value: ['builtin', builtins[name]]};
      } else {
        globalMap[name] = {name, value: ['function', node]};
      }
    }
  });

  // Initialize the memory, control, and scope data structures.
  const limit = 0x10000;
  const memory = allocate(limit);
  const writeLog = Immutable.List();
  const control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: 'main'}, []]]]]],
    step: 0
  };
  const scope = {key: 0, limit: limit};
  const state = {globalMap, memory, writeLog, control, scope};

  return state;
};

export const applyStep = function (state, step, options) {
  let newState = {...state};
  // Update the control structure.
  newState.control = step.control;
  // Copy the step's result.
  if ('result' in step) {
    newState.result = step.result;
    newState.direction = 'up';
  } else {
    newState.result = undefined;
    newState.direction = 'down';
  }
  // Apply any effects.
  if ('effects' in step) {
    // Perform the side-effects.
    step.effects.forEach(function (effect) {
      applyEffect(newState, effect, options);
    });
  }
  return newState;
};

export const clearMemoryLog = function (state) {
  return {...state, memoryLog: Immutable.List(), oldMemory: state.memory};
};

export const step = function (state, options) {
  // Performs a single step.
  const control = state.control;
  if (!control) {
    // Program is halted.
    return state;
  }
  const step = getStep(state, control);
  if ('error' in step) {
    // Evaluation cannot proceed due to an error.
    return {...state, error: step.error};
  }
  // Apply the effects.
  return applyStep(state, step, options);
};


const refsIntersect = function (ref1, ref2) {
  const base1 = ref1.address, limit1 = base1 + ref1.type.size - 1;
  const base2 = ref2.address, limit2 = base2 + ref2.type.size - 1;
  const result = (base1 <= base2) ? (base2 <= limit1) : (base1 <= limit2);
  return result;
};

export const inspectPointer = function (pointer, state) {
  const {memoryLog, memory, oldMemory} = state;
  const result = {type: pointer.type.pointee};
  try {
    result.value = readValue(memory, pointer);
    memoryLog.forEach(function (entry, i) {
      if (refsIntersect(pointer, entry[1])) {
        if (entry[0] === 'load') {
          if (result.load === undefined) {
            result.load = i;
          }
        } else if (entry[0] === 'store') {
          if (result.store === undefined) {
            result.store = i;
            result.prevValue = readValue(oldMemory, pointer);
          }
        }
      }
    });
  } catch (err) {
    result.error = err.toString();
  }
  return result;
};

export const outOfCurrentStmt = function (state) {
  return state.direction === 'down' && state.control.seq === 'stmt';
};

export const intoNextStmt = function (state) {
  return !/^(CompoundStmt|IfStmt|WhileStmt|DoStmt|ForStmt)$/.test(state.control.node[0]);
};

export const intoNextExpr = function (state) {
  return state.direction === 'down' && state.control.seq;
};
