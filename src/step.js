/*

Sequence points are marked in reduction steps by returning an object
with the seq property set to true.  In C, sequence points occur:
  - after evaluating the left operand of '&&', '||', ','
  - after evaluating cond in (cond '?' ift ':' iff)
  - at the end a full expression, that is:
    - after evaluating each compound statement
    - after a return statement
    - controlling expressions of if, switch, while, do/while, for
    - before entering a function in a call
    - after each initializer

*/

import {
  scalarTypes, pointerType, functionType, arrayType, decayedType} from './type';
import {
  IntegralValue, FloatingValue, PointerValue, BuiltinValue, FunctionValue, ArrayValue,
  evalUnaryOperation, evalBinaryOperation, evalCast, evalPointerAdd} from './value';
import {findLocalDeclaration} from './scope';
import {writeValue, readValue} from './memory';
import {finalizeVarDecl} from './decl';

const one = new IntegralValue(scalarTypes['int'], 1);

const findDeclaration = function (core, name) {
  return findLocalDeclaration(core.scope, name) || core.globalMap[name];
};

const enter = function (node, cont, attrs) {
  return {node, step: 0, cont, ...attrs};
};

const enterExpr = function (node, cont, attrs) {
  return {node, step: 0, cont, seq: 'expr', ...attrs};
};

const enterStmt = function (node, cont, attrs) {
  return {node, step: 0, cont, seq: 'stmt', ...attrs};
};

const stepCompoundStmt = function (core, control) {
  const {node, step} = control;

  // When falling through the end of the block, issue a 'leave' effect to
  // clean up the block's scope.
  if (step >= node[2].length) {
    return {
      result: null, control: control.cont,
      effects: [['leave', node]],
    };
  }

  // Set up a continuation and pass control to the next child.
  const cont = {...control, step: step + 1};
  const result = {control: enterStmt(node[2][step], cont)};

  // Set up a frame for the block's declarations when entering the block.
  if (step === 0) {
    result.effects = [['enter', node]];
  }

  return result;
};

const stepDeclStmt = function (core, control) {
  const {node, step} = control;
  if (step < node[2].length) {
    // Pass control to the next child, setting up the continuation
    // for the next step.
    return {
      control: enter(node[2][step], {...control, step: step + 1})
    };
  }
  // No next child: return void and pass control to the continuation.
  return {control: control.cont, result: null};
};

const stepParenExpr = function (core, control) {
  if (control.step === 0) {
    // ParenExpr is transparent w.r.t. the evaluation mode (value/lvalue/type).
    return {
      control: enter(
        control.node[2][0], {...control, step: 1}, {mode: control.mode})
    };
  } else {
    const result = core.result;
    return {control: control.cont, result};
  }
};

const stepForStmt = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    // enter init, continue w/ step 1
    return {control: enterStmt(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // enter cond, continue w/ step 3
    return {control: enterStmt(node[2][1], {...control, step: 3})};
  }
  if (step === 2) {
    // enter update, continue w/ step 1
    return {control: enterStmt(node[2][2], {...control, step: 1})};
  }
  if (step === 3) {
    // result ? (enter body, continue w/ step 2) : leave
    if (core.result.toBool()) {
      return {control: enterStmt(node[2][3], {...control, step: 2, break: 4})};
    }
  }
  return {control: control.cont, result: null};
};

const stepWhileStmt = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    // enter cond, continue w/ step 1
    return {control: enterStmt(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // result ? (enter body, continue w/ step 0) : leave
    if (core.result.toBool()) {
      return {control: enterStmt(node[2][1], {...control, step: 0, break: 2})};
    }
  }
  return {control: control.cont, result: null};
};

const stepDoStmt = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    // enter body, continue w/ step 1
    return {control: enterStmt(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // enter cond, continue w/ step 2
    return {control: enterStmt(node[2][1], {...control, step: 2})};
  }
  if (step === 2) {
    // result ? (enter body, continue w/ step 1) : leave
    if (core.result.toBool()) {
      const cont = {...control, step: 1, break: 3};
      return {control: enterStmt(node[2][0], cont)};
    }
  }
  return {control: control.cont, result: null};
};

const stepBreakStmt = function (core, control) {
  let cont = control;
  do {
    cont = cont.cont;
  } while (!('break' in cont));
  return {control: {...cont, step: cont.break, seq: 'stmt'}, result: null};
};

const stepContinueStmt = function (core, control) {
  let cont = control;
  do {
    cont = cont.cont;
  } while (!('break' in cont));
  return {control: {...cont, seq: 'stmt'}, result: null};
};

const stepIfStmt = function (core, control) {
  const {node, step} = control;
  switch (step) {
  case 0:
    // No 'statement' boundary around the condition.
    return {control: enterExpr(node[2][0], {...control, step: 1})};
  case 1:
    if (core.result.toBool()) {
      return {control: enterStmt(node[2][1], {...control, step: 2})};
    } else {
      if (node[2].length === 3)
        return {control: enterStmt(node[2][2], {...control, step: 2})};
      else
        return {control: control.cont, result: null};
    }
  case 2:
    return {control: control.cont, result: null};
  }
};

const stepReturnStmt = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    // Evaluate the expression whose value to return.
    return {control: enterExpr(node[2][0], {...control, step: 1})};
  }
  // Transfering the control to 'return' indicates a function return.
  return {control: 'return', result: core.result};
};

const stepCallExpr = function (core, control) {
  const {node, step} = control;
  // Numeric steps accumulate the results of evaluating each child expression.
  let values = control.values;
  if (typeof step === 'number') {
    if (step === 0) {
      values = [];
    } else {
      values = values.slice();
      values.push(core.result);
    }
    if (step < node[2].length) {
      // Pass control to the next child, setting up the continuation
      // for the next step.
      return {
        control: enterExpr(node[2][step], {...control, step: step + 1, values})
      };
    }
    const funcVal = values[0];
    // All arguments have been evaluated, perform the call.
    if (funcVal instanceof BuiltinValue) {
      // A builtin function handles the rest of the call step.
      return funcVal.func(core, control.cont, values);
    }
    if (funcVal instanceof FunctionValue) {
      // A user-defined function holds the FunctionDecl node.
      const funcNode = funcVal.decl;
      const funcTypeNode = funcNode[2][1];
      return {
        control: enter(funcTypeNode, {...control, step: 'F', values})
      };
    }
    return {control, error: `call error ${funcVal}`};
  }
  const funcVal = values[0];
  const funcNode = funcVal.decl;
  if (step === 'F') {
    // The F step uses the evaluated type of the callee to set up the values of
    // its formal parameters in its scope.
    const funcType = core.result;
    // The 'call' effect will open a function scope and store in it the return
    // continuation and the function call values.
    const cont = {...control, step: 'R'};
    const effects = [['call', cont, values]];
    // Emit a 'vardecl' effect for each function argument.
    const params = funcType.params;
    for (let i = 0; i < params.length; i++) {
      const {name, type} = params[i];
      const init = i + 1 >= values.length ? null : values[1 + i];
      effects.push(['vardecl', name, type, init]);
    }
    // Transfer control to the function body (a compound statement), setting
    // 'return' as the continuation to obtain the effect of a "return;"
    // statement if execution falls through the end of the block.
    const funcBody = funcNode[2][2];
    return {
      effects,
      control: enterStmt(funcBody, 'return')
    };
  }
  if (step === 'R') {
    // The R step catches the callee's result and is only used as a stop to
    // show the call's result while the function and arguments are still
    // accessible (as control.values).
    return {
      control: control.cont,
      result: core.result
    };
  }
};

const stepImplicitCastExpr = function (core, control) {
  // An implicit cast (T)e has children [e, T] (reverse of explicit cast).
  // T is evaluated first (in normal mode) so that the evaluation of e can be
  // skipped if we are in type mode.
  const {node, step} = control;
  if (step === 0) {
    return {
      control: enter(node[2][1], {...control, step: 1})
    };
  }
  if (control.mode === 'type') {
    return {control: control.cont, result: core.result};
  }
  if (step === 1) {
    // An implicit cast is transparent w.r.t. the value/lvalue mode.
    // XXX Does it really happen?
    return {
      control: enter(node[2][0], {...control, step: 2, type: core.result}, {mode: control.mode})
    };
  }
  const type = control.type;
  const value = core.result;
  const result = evalCast(type, value);
  return {control: control.cont, result};
};

const stepExplicitCastExpr = function (core, control) {
  // An explicit cast (T)e has children [T, e] (reverse of implicit cast).
  const {node, step} = control;
  if (step === 0) {
    return {
      control: enter(node[2][0], {...control, step: 1})
    };
  }
  if (control.mode === 'type') {
    return {control: control.cont, result: core.result};
  }
  if (step === 1) {
    return {
      control: enterExpr(node[2][1], {...control, step: 2, type: core.result})
    };
  }
  const type = control.type;
  const value = core.result;
  const result = evalCast(type, value);
  return {control: control.cont, result};
};

const stepDeclRefExpr = function (core, control) {
  const nameNode = control.node[2][0];
  const ref = findDeclaration(core, nameNode[1].identifier);
  const effects = [];
  let result;
  if (ref instanceof PointerValue) {
    if (control.mode === 'type') {
      if (ref.type.kind === 'pointer') {
        result = ref.type.pointee;
      } else {
        result = ref.type;
      }
    } else if (control.mode === 'lvalue') {
      result = ref;
    } else {
      const varType = ref.type.pointee;
      if (varType.kind === 'array') {
        // A reference to an array evaluates to a pointer to the array's
        // first element.
        result = new PointerValue(decayedType(varType), ref.address);
      } else {
        result = readValue(core.memory, ref);
        effects.push(['load', ref]);
      }
    }
  } else {
    // If findDeclaration returns a non-pointer value (typically a function or
    // a builtin), use the value directly and disallow taking its address.
    if (control.mode === 'lvalue') {
      throw new Error(`cannot take address of ${name[1].identifier}`);
    } else {
      result = ref;
    }
  }
  return {control: control.cont, result, effects};
};

const stepUnaryOperator = function (core, control) {
  if (control.step === 0) {
    // Evaluate the operand.
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1})
    };
  } else {
    const value = core.result;
    const result = evalUnaryOperation(control.node[1].opcode, value);
    return {control: control.cont, result};
  }
};

const stepAssignmentUnaryOperator = function (core, control) {
  if (control.step === 0) {
    // Evaluate the operand as a lvalue.
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else {
    const lvalue = core.result;
    const oldValue = readValue(core.memory, lvalue);
    const opcode = control.node[1].opcode;
    const binOp = /Inc$/.test(opcode) ? 'Add' : 'Sub';
    const newValue = evalBinaryOperation(binOp, oldValue, one);
    const result = /^Pre/.test(opcode) ? newValue : oldValue;
    return {
      control: control.cont,
      effects: [
        ['load', lvalue],
        ['store', lvalue, newValue]
      ],
      result
    };
  }
};

const stepAddrOf = function (core, control) {
  if (control.step === 0) {
    // If in 'type' mode, evaluate operand in type mode.
    // Otherwise, switch to 'lvalue' mode.
    const mode = control.mode === 'type' ? 'type' : 'lvalue';
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode})
    };
  } else {
    // If in 'type' mode, return a pointer-to-operand's type type.
    // Otherwise, the lvalue-result (a pointer value) is returned.
    let result = core.result;
    if (control.mode === 'type') {
      result = pointerType(result);
    }
    return {control: control.cont, result};
  }
};

const stepDeref = function (core, control) {
  if (control.step === 0) {
    // Transition out of 'lvalue' mode.
    const mode = control.mode === 'lvalue' ? undefined : control.mode;
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1}, {mode})
    };
  } else {
    // Pass the result.
    if (control.mode === 'type') {
      // In type-mode (*a) evaluates to T if a has type T*.
      return {control: control.cont, result: core.result.pointee};
    }
    if (control.mode === 'lvalue') {
      // Dereferencing was performed by evaluating the operand in value mode.
      return {control: control.cont, result: core.result};
    }
    // Normal value-mode path.
    const lvalue = core.result;
    const effects = [['load', lvalue]];
    // XXX special case if lvalue.type.pointee.kind === 'array'?
    const result = readValue(core.memory, lvalue);
    return {control: control.cont, result, effects};
  }
};

const stepUnaryExprOrTypeTraitExpr = function (core, control) {
  // In C, this node kind is always sizeof.
  // TODO: include the type of the expression in the AST, so we can
  //       simply call sizeOfType.
  if (control.step === 0) {
    // Evaluate the operand in 'type' mode.
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1}, {mode: 'type'})
    };
  }
  const type = core.result;
  const result = new IntegralValue(scalarTypes['int'], type.size);
  return {control: control.cont, result};
};

const stepBinaryOperator = function (core, control) {
  if (control.step === 0) {
    // Before LHS.
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1})
    };
  } else if (control.step === 1) {
    // After LHS, before RHS.
    const lhs = core.result;
    const opcode = control.node[1].opcode;
    // Short-circuit evaluation for logical operators.
    if ((opcode === 'LAnd' && !lhs.toBool()) || (opcode === 'LOr' && lhs.toBool())) {
      return {control: control.cont, result: lhs};
    }
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, lhs})
    };
  } else {
    // After RHS.
    const rhs = core.result;
    const opcode = control.node[1].opcode;
    const result =
      /^(Comma|LOr|LAnd)$/.test(opcode) ? rhs : evalBinaryOperation(opcode, control.lhs, rhs);
    return {control: control.cont, result};
  }
};

const stepAssignmentOperator = function (core, control) {
  if (control.step === 0) {
    // Before LHS (as lvalue).
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else if (control.step === 1) {
    // After LHS, before RHS.
    const lvalue = core.result;
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, lvalue})
    };
  } else {
    // After RHS.
    const lvalue = control.lvalue;
    const {result} = core;
    const effects = [['store', lvalue, result]];
    return {control: control.cont, result, effects};
  }
};

const stepAssignmentBinaryOperator = function (core, control) {
  if (control.step === 0) {
    // Before LHS (as lvalue).
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else if (control.step === 1) {
    // After LHS, before RHS.
    const lvalue = core.result;
    const lhs = readValue(core.memory, lvalue);
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, lvalue, lhs}),
      effects: [['load', lvalue]]
    };
  } else {
    // After RHS.
    const {lvalue, lhs} = control;
    const rhs = core.result;
    const opcode = control.node[1].opcode.replace('Assign', '');
    const result = evalBinaryOperation(opcode, lhs, rhs);
    const effects = [['store', lvalue, result]];
    return {control: control.cont, result, effects};
  }
};

const stepArraySubscriptExpr = function (core, control) {
  if (control.step === 0) {
    // Before array expr.
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1})
    };
  } else if (control.step === 1) {
    // After array expr, before subscript expr.
    const array = core.result;
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, array})
    };
  } else {
    // After subscript expr.
    const array = control.array;
    const subscript = core.result;
    const ref = evalPointerAdd(array, subscript);
    const effects = [];
    let result;
    if (control.mode === 'lvalue' || ref.type.pointee.kind === 'array') {
      result = ref;
    } else {
      result = readValue(core.memory, ref);
      effects.push(['load', ref]);
    }
    return {control: control.cont, result, effects};
  }
};

const stepInitListExpr = function (core, control) {
  const {node, step} = control;
  let elements;
  if (step === 0) {
    elements = [];
  } else {
    elements = control.elements.slice();
    elements.push(core.result);
  }
  if (step < node[2].length) {
    return {
      control: enterExpr(node[2][step], {...control, step: step + 1, elements})
    };
  }
  return {
    control: control.cont,
    result: elements
  };
};

const stepConditionalOperator = function (core, control) {
  const {node, step} = control;
  switch (step) {
  case 0:
    // Evaluate the condition operand.
    return {control: enterExpr(node[2][0], {...control, step: 1})};
  case 1:
    // Evaluate the operand depending on the result's truthiness.
    if (core.result.toBool()) {
      return {control: enterExpr(node[2][1], {...control, step: 2})};
    } else {
      return {control: enterExpr(node[2][2], {...control, step: 2})};
    }
  case 2:
    // Pass the result upwards.
    return {control: control.cont, result: core.result};
  }
};

const stepVarDecl = function (core, control) {
  // VarDecl children are [type, init?] (init is optional).
  const {node, step} = control;
  // The type is evaluated in case it contains expressions,
  // as for instance in the case of ConstantArrayType.
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  // Evaluate the initializer, if present.
  if (step === 1 && node[2].length === 2) {
    const type = core.result;
    return {control: enterExpr(node[2][1], {...control, step: 2, type})};
  }
  const {name} = control.node[1];
  const preType = step === 1 ? core.result : control.type;
  const preInit = step === 2 ? core.result : null;
  const {type, init} = finalizeVarDecl(preType, preInit);
  const effects = [['vardecl', name, type, init]];
  return {control: control.cont, result: null, effects};
};

const stepIntegerLiteral = function (core, control) {
  const value = control.node[1].value;
  // XXX use different type if value ends with l, ll, ul, ull
  return {
    control: control.cont,
    result: new IntegralValue(scalarTypes['int'], parseInt(value))
  };
};

const stepCharacterLiteral = function (core, control) {
  const value = control.node[1].value;
  // XXX use 'unsigned char' if value ends with 'u'
  return {
    control: control.cont,
    result: new IntegralValue(scalarTypes['char'], parseInt(value))
  };
};

const stepFloatingLiteral = function (core, control) {
  const value = control.node[1].value;
  const type = /[fF]$/.test(value) ? scalarTypes['float'] : scalarTypes['double'];
  return {
    control: control.cont,
    result: new FloatingValue(type, parseFloat(value))
  };
};

const stepStringLiteral = function (core, control) {
  return {
    control: control.cont,
    result: control.node[1].ref
  };
};

const stepBuiltinType = function (core, control) {
  const {name} = control.node[1];
  const result = scalarTypes[name];
  return {control: control.cont, result};
};

const stepPointerType = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  const result = pointerType(core.result);
  return {control: control.cont, result};
};

const stepConstantArrayType = function (core, control) {
  // A ConstantArrayType has a 'size' attribute and a single type child.
  const {node, step} = control;
  if (step === 0) {
    // Evaluate the type expression.
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  const elemType = core.result;
  const elemCount = new IntegralValue(scalarTypes['unsigned int'], parseInt(node[1].size));
  const result = arrayType(elemType, elemCount);
  return {control: control.cont, result};
};

const stepVariableArrayType = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    // Evaluate the type expression.
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // Evaluate the size expression.
    const elemType = core.result;
    return {control: enter(node[2][1], {...control, step: 2, elemType})};
  }
  const {elemType} = control;
  const elemCount = core.result;
  const result = arrayType(elemType, elemCount);
  return {control: control.cont, result};
};

const stepIncompleteArrayType = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  const elemType = core.result;
  const result = arrayType(elemType, undefined);
  return {control: control.cont, result};
};

const stepFunctionProtoType = function (core, control) {
  const {node, step} = control;
  const cont = {...control, step: step + 1};
  if (step === 1) {
    cont.result = core.result;
    cont.params = [];
  } else if (step > 1) {
    cont.params = control.params.slice();
    cont.params.push(core.result);
  }
  if (step < node[2].length) {
    return {control: enter(node[2][step], cont)};
  }
  return {
    control: control.cont,
    result: functionType(cont.result, cont.params)
  };
};

const stepParmVarDecl = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    // Evaluate the type.
    return {
      control: enter(node[2][0], {...control, step: step + 1})
    };
  }
  const name = node[1].name;
  const type = core.result;
  return {control: control.cont, result: {name, type}};
};

const stepParenType = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  } else {
    return {control: control.cont, result: core.result};
  }
};

const stepDecayedType = function (core, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  } else {
    return {control: control.cont, result: decayedType(core.result)};
  }
};

export const getStep = function (core) {
  const {control} = core;
  switch (control.node[0]) {
  case 'CompoundStmt':
    return stepCompoundStmt(core, control);
  case 'DeclStmt':
    return stepDeclStmt(core, control);
  case 'ForStmt':
    return stepForStmt(core, control);
  case 'WhileStmt':
    return stepWhileStmt(core, control);
  case 'DoStmt':
    return stepDoStmt(core, control);
  case 'BreakStmt':
    return stepBreakStmt(core, control);
  case 'ContinueStmt':
    return stepContinueStmt(core, control);
  case 'IfStmt':
    return stepIfStmt(core, control);
  case 'ReturnStmt':
    return stepReturnStmt(core, control);
  case 'VarDecl':
    return stepVarDecl(core, control);
  case 'ParenExpr':
    return stepParenExpr(core, control);
  case 'CallExpr':
    return stepCallExpr(core, control);
  case 'ImplicitCastExpr':
    return stepImplicitCastExpr(core, control);
  case 'CStyleCastExpr':
    return stepExplicitCastExpr(core, control);
  case 'DeclRefExpr':
    return stepDeclRefExpr(core, control);
  case 'IntegerLiteral':
    return stepIntegerLiteral(core, control);
  case 'CharacterLiteral':
    return stepCharacterLiteral(core, control);
  case 'FloatingLiteral':
    return stepFloatingLiteral(core, control);
  case 'StringLiteral':
    return stepStringLiteral(core, control);
  case 'UnaryOperator':
    switch (control.node[1].opcode) {
      case 'Plus': case 'Minus': case 'LNot': case 'Not':
        return stepUnaryOperator(core, control);
      case 'PreInc': case 'PreDec': case 'PostInc': case 'PostDec':
        return stepAssignmentUnaryOperator(core, control);
      case 'AddrOf':
        return stepAddrOf(core, control);
      case 'Deref':
        return stepDeref(core, control);
      default:
        return {
          control,
          error: `cannot step through UnaryOperator ${control.node[1].opcode}`
        };
    }
    break;
  case 'UnaryExprOrTypeTraitExpr':
    return stepUnaryExprOrTypeTraitExpr(core, control);
  case 'BinaryOperator':
    if (control.node[1].opcode === 'Assign') {
      return stepAssignmentOperator(core, control);
    } else {
      return stepBinaryOperator(core, control);
    }
  case 'CompoundAssignOperator':
    return stepAssignmentBinaryOperator(core, control);
  case 'ArraySubscriptExpr':
    return stepArraySubscriptExpr(core, control);
  case 'InitListExpr':
    return stepInitListExpr(core, control);
  case 'ConditionalOperator':
    return stepConditionalOperator(core, control);
  case 'BuiltinType':
    return stepBuiltinType(core, control);
  case 'PointerType':
    return stepPointerType(core, control);
  case 'ConstantArrayType':
    return stepConstantArrayType(core, control);
  case 'VariableArrayType':
    return stepVariableArrayType(core, control);
  case 'IncompleteArrayType':
    return stepIncompleteArrayType(core, control);
  case 'FunctionProtoType':
  case 'FunctionNoProtoType':
    return stepFunctionProtoType(core, control);
  case 'ParmVarDecl':
    return stepParmVarDecl(core, control);
  case 'ParenType':
    return stepParenType(core, control);
  case 'DecayedType':
    return stepDecayedType(core, control);
  }
  return {
    control,
    error: `cannot step through ${control.node[0]}`
  };
};
