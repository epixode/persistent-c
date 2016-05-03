
import Immutable from 'immutable';

import {pointerType} from './type';
import {PointerValue, stringValue} from './value';
import {allocate, readValue, writeValue, readString} from './memory';
import {getStep} from './step';
import {applyEffect} from './effects';

export {pointerType, scalarTypes} from './type';
export {IntegralValue, FloatingValue, PointerValue, stringValue} from './value';
export {readValue, writeValue, readString} from './memory';
export {getStep} from './step';
export {defaultEffects} from './effects';

export const start = function (context) {
  const {decls, builtins} = context;

  // Initialize the memory, control, and scope data structures.
  const limit = 0x10000;
  let memory = allocate(limit);
  let heapStart = 0x100;
  const writeLog = Immutable.List();
  const globalMap = {};
  const scope = {key: 0, limit: limit};
  const state = {globalMap, writeLog, scope};

  // Built the map of global variables.
  // const intFunc = functionType(scalarTypes['int'], []);
  decls.forEach(function (declNode) {

    // Copy string literals to memory.
    forEachNode(declNode, function (node) {
      if (node[0] === 'StringLiteral') {
        const value = stringValue(node[1].value);
        const ref = new PointerValue(value.type, heapStart);
        memory = writeValue(memory, ref, value);
        heapStart += value.type.size;
        node[1].ref = ref;
        console.log('string', value, ref, heapStart);
      }
    });

    // Add the declaration to the global map.
    switch (declNode[0]) {
      case 'VarDecl': {
        const typeNode = declNode[2][0];
        const initNode = declNode[2][1];
        // const typeVal = evalExpr(state, typeNode);
        // XXX allocate memory and create a pointer
        // XXX if the initNode is an InitListExpr, store the pointer (and
        //     0-initialized index) in the control structure while evaluating
        //     the node.
        break;
      }
      case 'FunctionDecl': {
        const name = declNode[2][0][1].identifier;
        // TODO: evaluate the type...
        if (builtins && name in builtins) {
          globalMap[name] = {name, value: ['builtin', builtins[name]]};
        } else {
          globalMap[name] = {name, value: ['function', declNode]};
        }
        break;
      }
    }
  });

  state.memory = memory;
  state.heapStart = heapStart;

  state.control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: 'main'}, []]]]]],
    step: 0
  };

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

const forEachNode = function (node, callback) {
  const queue = [[node]];
  while (queue.length !== 0) {
    queue.pop().forEach(function (node) {
      callback(node);
      if (node[2].length !== 0) {
        queue.push(node[2]);
      }
    });
  }
};

const refsIntersect = function (ref1, ref2) {
  const base1 = ref1.address, limit1 = base1 + ref1.pointee.type.size - 1;
  const base2 = ref2.address, limit2 = base2 + ref2.pointee.type.size - 1;
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
