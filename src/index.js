
import Immutable from 'immutable';

import {builtinTypes, pointerType} from './type';
import {PointerValue, stringValue, BuiltinValue, FunctionValue} from './value';
import {allocate, readValue, writeValue, readString} from './memory';
import {getStep} from './step';
import {finalizeVarDecl} from './decl';
import {declEffectHandlers} from './effects';

export {functionType, pointerType, arrayType, decayedType, builtinTypes} from './type';
export {
  IntegralValue, FloatingValue, PointerValue, stringValue, makeRef} from './value';
export {readValue, writeValue, readString} from './memory';
export {getStep} from './step';
export {findClosestFunctionScope} from './scope';
export {defaultEffectHandlers} from './effects';

export function makeCore (memorySize) {
  if (memorySize === undefined) {
    memorySize = 0x10000;
  }
  const globalMap = {};
  const recordDecls = {};
  const functions = [null];
  const memory = allocate(memorySize);
  const memoryLog = Immutable.List();
  const heapStart = 0x100;
  const scope = {key: 0, limit: memorySize};
  return {globalMap, recordDecls, functions, memory, memoryLog, heapStart, scope};
};

export function execDecls (core, decls, builtins) {
  const state = {core, builtins, handlers: declEffectHandlers};
  decls.forEach(function (declNode) {
    copyNodeStrings(core, declNode);
    stepThroughNode(state, declNode);
  });
};
const stepThroughNode = function (state, node) {
  state = {...state, core: {...state.core, control: {node, step: 0}}};
  while (state.core.control) {
    const effects = step(state);
    for (var effect of effects) {
      state.handlers[effect[0]](state, effect);
    }
  }
  return state.core.result;
};

export function setupCall (core, name) {
  core.control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: name}, []]]]]],
    step: 0,
    cont: null
  };
}

function copyNodeStrings (core, node) {
  /* Copy string literals to memory. */
  forEachNode(node, function (node) {
    if (node[0] === 'StringLiteral') {
      const value = stringValue(node[1].value);
      const ref = new PointerValue(value.type, core.heapStart);
      core.memory = writeValue(core.memory, ref, value);
      core.heapStart += value.type.size;
      node[1].ref = ref;
    }
  });
}

export const clearMemoryLog = function (core) {
  return {...core, memoryLog: Immutable.List()};
};

/* Updates 'state' and return a list of effects. */
export const step = function (state) {
  let {core} = state;
  // Performs a single step.
  if (!core.control) {
    // Program is halted.
    throw new Error('halted');
  }
  const step = getStep(core);
  if (!step) {
    throw new Error('stuck');
  }
  if ('error' in step) {
    throw new Error(step.error);
  }
  /* Make a fresh core object that effects can update. */
  core = state.core = {...core, control: step.control};
  const effects = step.effects || [];
  /* Copy the step's result if present, set the direction accordingly. */
  if ('result' in step) {
    core.result = step.result;
    core.direction = 'up';
  } else {
    core.result = undefined;
    core.direction = 'down';
  }
  return effects;
};

export const forEachNode = function (node, callback) {
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

export const outOfCurrentStmt = function (core) {
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
