
import Immutable from 'immutable';

import {scalarTypes, pointerType} from './type';
import {PointerValue, stringValue, BuiltinValue, FunctionValue} from './value';
import {allocate, readValue, writeValue, readString} from './memory';
import {getStep} from './step';
import {applyEffect} from './effects';

export {pointerType, scalarTypes} from './type';
export {
  IntegralValue, FloatingValue, PointerValue, stringValue,
  BuiltinValue, FunctionValue} from './value';
export {readValue, writeValue, readString} from './memory';
export {getStep} from './step';
export {findClosestFunctionScope} from './scope';
export {defaultEffects} from './effects';

export const start = function (context) {
  const {decls, builtins} = context;

  // Initialize the memory, control, and scope data structures.
  const limit = 0x10000;
  let memory = allocate(limit);
  let heapStart = 0x100;
  const writeLog = Immutable.List();
  const globalMap = {};
  let scope = {key: 0, limit: limit};
  const core = {globalMap, writeLog, scope};

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
      }
    });

    // Add the declaration to the global map.
    // TODO: evaluate the types and init values
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
        if (builtins && name in builtins) {
          globalMap[name] = new BuiltinValue(name, builtins[name]);
        } else {
          globalMap[name] = new FunctionValue(declNode);
        }
        break;
      }
    }
  });

  core.memory = memory;
  core.heapStart = heapStart;

  // TODO: pass argc, argv to 'main'
  core.control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: 'main'}, []]]]]],
    step: 0,
    cont: null
  };

  return core;
};

export const applyStep = function (state, step, options) {
  // Make fresh objects that can be imperatively updated during the step.
  const newCore = {...state.core};
  const newState = {...state, core: newCore};
  const effects = step.effects || [];
  // Update the control structure, handling the special 'return' continuation.
  newCore.control = step.control;
  if (step.control === 'return') {
    // Transfering control to 'return' appends a 'return' effect, which avoids
    // having a dummy return node to handle execution falling through the end
    // of a block.
    effects.push(['return', step.result]);
  } else {
    // Normal control transfer copies the step's result if present, and sets
    // the direction accordingly.
    if ('result' in step) {
      newCore.result = step.result;
      newCore.direction = 'up';
    } else {
      newCore.result = undefined;
      newCore.direction = 'down';
    }
  }
  // Perform the side-effects.
  effects.forEach(function (effect) {
    applyEffect(newState, effect, options);
  });
  return newState;
};

export const clearMemoryLog = function (core) {
  return {...core, memoryLog: Immutable.List(), oldMemory: core.memory};
};

export const step = function (state, options) {
  // Performs a single step.
  if (!state.core.control) {
    // Program is halted.
    return state;
  }
  const step = getStep(state.core);
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
  const base1 = ref1.address, limit1 = base1 + ref1.type.pointee.size - 1;
  const base2 = ref2.address, limit2 = base2 + ref2.type.pointee.size - 1;
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

export const outOfCurrentStmt = function (core) {
  if (core.control.return)
    return true;
  return /down|out/.test(core.direction) && core.control.seq === 'stmt';
};

export const intoNextStmt = function (core) {
  return !/^(CompoundStmt|IfStmt|WhileStmt|DoStmt|ForStmt)$/.test(core.control.node[0]);
};

export const intoNextExpr = function (core) {
  return /down|out/.test(core.direction) && core.control.seq;
};

export const notInNestedCall = function (scope, refScope) {
  while (scope.key >= refScope.key) {
    if (scope.kind === 'function') {
      return false;
    }
    scope = scope.parent;
  }
  return true;
};
