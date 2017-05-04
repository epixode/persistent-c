/*

core: {
  globalMap,
  recordDecls,
  functions,
  memory,
  memoryLog,
  heapStart,
  scope,
  control,
  result,
  direction
}

*/


import Immutable from 'immutable';

import {builtinTypes, pointerType} from './type';
import {PointerValue, stringValue, BuiltinValue, FunctionValue} from './value';
import {allocate, readValue, writeValue, readString} from './memory';
import {step} from './step';
import {finalizeVarDecl} from './decl';
import effects from './effects';

export {functionType, pointerType, arrayType, decayedType, builtinTypes} from './type';
export {
  IntegralValue, FloatingValue, PointerValue, stringValue, makeRef} from './value';
export {readValue, writeValue, readString} from './memory';
export {step} from './step';
export {findClosestFunctionScope} from './scope';
export {default as effects} from './effects';

export const voidPtr = pointerType(builtinTypes['void']);
export const nullPointer = new PointerValue(voidPtr, 0);

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

export function execDecls (core, decls) {
  decls.forEach(function (declNode) {
    copyNodeStrings(core, declNode);
    stepThroughNode(core, declNode, declHandlers);
  });
};

const stepThroughNode = function (core, node, handlers) {
  core.control = {node, step: 0};
  while (core.control) {
    const effects = step(core);
    for (var effect of effects) {
      var name = effect[0];
      if (!(name in handlers)) {
        throw new Error(`unhandled core effect ${name}`);
      }
      handlers[name](core, ...effect.slice(1));
    }
  }
  return core.result;
};

const declHandlers = {
  control: effects.doControl,
  result:  effects.doResult,
  vardecl: effects.declareGlobalVar,
  recdecl: effects.declareRecord,
  fundecl: effects.declareFunction
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
      node[1].ref = ref; // TODO: use a WeakMap in core?
    }
  });
}

export const clearMemoryLog = function (core) {
  return {...core, memoryLog: Immutable.List()};
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
