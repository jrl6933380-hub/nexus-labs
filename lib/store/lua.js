// A small Lua 5.1 interpreter, just big enough to run the EVAL scripts this app sends to Redis.
//
// Why it exists: the app keeps its atomic logic (locks, metering, quotas, compare-and-set) in Lua scripts that
// were written for Redis. To run the same scripts unchanged against Postgres, the store runs them here, inside
// one database transaction, with `redis.call` wired to the store's own commands.
//
// What is supported: locals, assignment, if/while/for/repeat, closures, tables, the arithmetic / comparison /
// logic / concat / length operators, and the library functions the repo's scripts use (math, string, table,
// tonumber, tostring, type, pairs, ipairs, next, select, unpack, pcall, error, assert, cjson, redis.*).
// Anything outside that fails loudly with a LuaError that names the unsupported construct. It does not fail
// silently or guess.
//
// Differences from Redis worth knowing: an error halfway through a script rolls back the whole script (Redis
// keeps the effects that already ran), and a script that never ends is stopped after MAX_STEPS operations.

import crypto from 'node:crypto';

export class LuaError extends Error {
  constructor(message) { super(message); this.name = 'LuaError'; }
}

export const NULL = Object.freeze({ cjsonNull: true });
const MAX_STEPS = 2_000_000;

export class LuaTable {
  constructor() { this.map = new Map(); }
  get(key) { return this.map.get(key); }
  set(key, value) {
    if (key === undefined) throw new LuaError('table index is nil');
    if (typeof key === 'number' && Number.isNaN(key)) throw new LuaError('table index is NaN');
    if (value === undefined) this.map.delete(key); else this.map.set(key, value);
  }
  length() { let n = 0; while (this.map.has(n + 1)) n += 1; return n; }
  // Array part first (1..n), then everything else in insertion order.
  keys() {
    const n = this.length();
    const out = [];
    for (let i = 1; i <= n; i += 1) out.push(i);
    for (const key of this.map.keys()) {
      if (typeof key === 'number' && Number.isInteger(key) && key >= 1 && key <= n) continue;
      out.push(key);
    }
    return out;
  }
}

export function tableFrom(values) {
  const table = new LuaTable();
  values.forEach((value, index) => { if (value !== undefined) table.set(index + 1, value); });
  return table;
}

// ---------- number formatting (C's %.Ng) ----------

export function formatG(n, precision = 14) {
  if (Number.isNaN(n)) return n < 0 ? '-nan' : 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  const exponent = Number(n.toExponential(precision - 1).split('e')[1]);
  if (exponent < -4 || exponent >= precision) {
    let [mantissa, exp] = n.toExponential(precision - 1).split('e');
    if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
    const sign = exp[0] === '-' ? '-' : '+';
    let digits = exp.replace(/^[+-]/, '');
    if (digits.length < 2) digits = '0' + digits;
    return `${mantissa}e${sign}${digits}`;
  }
  let fixed = n.toFixed(Math.max(0, precision - 1 - exponent));
  if (fixed.includes('.')) fixed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return fixed;
}

export function luaToString(value) {
  if (value === undefined) return 'nil';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return formatG(value, 14);
  if (typeof value === 'string') return value;
  if (value instanceof LuaTable) return 'table: 0x0';
  if (value === NULL) return 'userdata: 0x0';
  return 'function: 0x0';
}

export function luaType(value) {
  if (value === undefined) return 'nil';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (value instanceof LuaTable) return 'table';
  if (value === NULL) return 'userdata';
  return 'function';
}

const truthy = (value) => value !== undefined && value !== false;

function parseLuaNumber(text) {
  const trimmed = String(text).trim();
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(trimmed)) return Number(trimmed.replace(/^([+-]?)0[xX]/, (m, s) => `${s}0x`));
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
  return undefined;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseLuaNumber(value);
  return undefined;
}

// ---------- lexer ----------

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const fail = (message) => { throw new LuaError(`user_script:${line}: ${message}`); };
  const longBracket = () => {
    // at source[i] === '[' — returns the level if this opens a long bracket, else -1
    let j = i + 1;
    let level = 0;
    while (source[j] === '=') { level += 1; j += 1; }
    return source[j] === '[' ? level : -1;
  };
  const readLong = (level) => {
    const close = `]${'='.repeat(level)}]`;
    const start = i + level + 2;
    const end = source.indexOf(close, start);
    if (end === -1) fail('unfinished long string/comment');
    let body = source.slice(start, end);
    if (body[0] === '\n') body = body.slice(1);
    for (const ch of source.slice(i, end + close.length)) if (ch === '\n') line += 1;
    i = end + close.length;
    return body;
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '-' && source[i + 1] === '-') {
      i += 2;
      if (source[i] === '[') {
        const level = longBracket();
        if (level >= 0) { readLong(level); continue; }
      }
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      const word = source.slice(i, j);
      tokens.push({ type: KEYWORDS.has(word) ? 'kw' : 'name', value: word, line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] || ''))) {
      const match = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(source.slice(i));
      tokens.push({ type: 'num', value: Number(match[0]), line });
      i += match[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = '';
      while (true) {
        if (j >= source.length || source[j] === '\n') fail('unfinished string');
        const c = source[j];
        if (c === ch) { j += 1; break; }
        if (c === '\\') {
          const n = source[j + 1];
          const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
          if (n in simple) { out += simple[n]; if (n === '\n') line += 1; j += 2; continue; }
          if (/[0-9]/.test(n)) {
            const digits = /^\d{1,3}/.exec(source.slice(j + 1))[0];
            out += String.fromCharCode(Number(digits));
            j += 1 + digits.length;
            continue;
          }
          out += n;
          j += 2;
          continue;
        }
        out += c;
        j += 1;
      }
      tokens.push({ type: 'str', value: out, line });
      i = j;
      continue;
    }
    if (ch === '[') {
      const level = longBracket();
      if (level >= 0) { const startLine = line; const value = readLong(level); tokens.push({ type: 'str', value, line: startLine }); continue; }
    }
    const three = source.slice(i, i + 3);
    const two = source.slice(i, i + 2);
    if (three === '...') { tokens.push({ type: 'op', value: '...', line }); i += 3; continue; }
    if (['==', '~=', '<=', '>=', '..'].includes(two)) { tokens.push({ type: 'op', value: two, line }); i += 2; continue; }
    if ('+-*/%^#<>=(){}[];:,.'.includes(ch)) { tokens.push({ type: 'op', value: ch, line }); i += 1; continue; }
    fail(`unexpected symbol near '${ch}'`);
  }
  tokens.push({ type: 'eof', value: '<eof>', line });
  return tokens;
}

// ---------- parser ----------

const BINARY_PRECEDENCE = {
  or: [1, 1], and: [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
  '..': [5, 4], '+': [6, 6], '-': [6, 6], '*': [7, 7], '/': [7, 7], '%': [7, 7], '^': [10, 9],
};
const UNARY_PRECEDENCE = 8;

class Parser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }
  peek() { return this.tokens[this.index]; }
  next() { return this.tokens[this.index++]; }
  is(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
  accept(type, value) { return this.is(type, value) ? this.next() : null; }
  fail(message) { throw new LuaError(`user_script:${this.peek().line}: ${message} near '${this.peek().value}'`); }
  expect(type, value) { const t = this.accept(type, value); if (!t) this.fail(`'${value ?? type}' expected`); return t; }

  parseChunk() { const body = this.block(); if (!this.is('eof')) this.fail('<eof> expected'); return body; }

  block() {
    const statements = [];
    while (true) {
      const t = this.peek();
      if (t.type === 'eof' || (t.type === 'kw' && ['end', 'else', 'elseif', 'until'].includes(t.value))) break;
      if (t.type === 'kw' && t.value === 'return') {
        this.next();
        let values = [];
        const n = this.peek();
        const blockEnd = n.type === 'eof' || (n.type === 'kw' && ['end', 'else', 'elseif', 'until'].includes(n.value)) || (n.type === 'op' && n.value === ';');
        if (!blockEnd) values = this.exprList();
        this.accept('op', ';');
        statements.push({ type: 'return', values });
        break;
      }
      const s = this.statement();
      if (s) statements.push(s);
    }
    return statements;
  }

  statement() {
    const t = this.peek();
    if (t.type === 'op' && t.value === ';') { this.next(); return null; }
    if (t.type === 'kw') {
      switch (t.value) {
        case 'if': return this.ifStatement();
        case 'while': { this.next(); const cond = this.expr(); this.expect('kw', 'do'); const body = this.block(); this.expect('kw', 'end'); return { type: 'while', cond, body }; }
        case 'do': { this.next(); const body = this.block(); this.expect('kw', 'end'); return { type: 'do', body }; }
        case 'for': return this.forStatement();
        case 'repeat': { this.next(); const body = this.block(); this.expect('kw', 'until'); const cond = this.expr(); return { type: 'repeat', body, cond }; }
        case 'function': {
          this.next();
          let target = { type: 'name', name: this.expect('name').value };
          let isMethod = false;
          while (this.is('op', '.') || this.is('op', ':')) {
            const sep = this.next().value;
            target = { type: 'index', obj: target, key: { type: 'str', value: this.expect('name').value } };
            if (sep === ':') { isMethod = true; break; }
          }
          const func = this.functionBody(isMethod);
          return { type: 'assign', targets: [target], values: [func] };
        }
        case 'local': {
          this.next();
          if (this.accept('kw', 'function')) {
            const name = this.expect('name').value;
            return { type: 'localfunction', name, func: this.functionBody(false) };
          }
          const names = [this.expect('name').value];
          while (this.accept('op', ',')) names.push(this.expect('name').value);
          const values = this.accept('op', '=') ? this.exprList() : [];
          return { type: 'local', names, values };
        }
        case 'break': this.next(); return { type: 'break' };
        default: break;
      }
    }
    const expression = this.suffixedExpression();
    if (this.is('op', '=') || this.is('op', ',')) {
      const targets = [expression];
      while (this.accept('op', ',')) targets.push(this.suffixedExpression());
      this.expect('op', '=');
      const values = this.exprList();
      for (const target of targets) if (target.type !== 'name' && target.type !== 'index') this.fail('cannot assign to this expression');
      return { type: 'assign', targets, values };
    }
    if (expression.type !== 'call' && expression.type !== 'mcall') this.fail('syntax error');
    return { type: 'callstat', call: expression };
  }

  ifStatement() {
    this.next();
    const clauses = [];
    let elseBody = null;
    const cond = this.expr();
    this.expect('kw', 'then');
    clauses.push({ cond, body: this.block() });
    while (true) {
      if (this.accept('kw', 'elseif')) { const c = this.expr(); this.expect('kw', 'then'); clauses.push({ cond: c, body: this.block() }); continue; }
      if (this.accept('kw', 'else')) { elseBody = this.block(); }
      break;
    }
    this.expect('kw', 'end');
    return { type: 'if', clauses, elseBody };
  }

  forStatement() {
    this.next();
    const first = this.expect('name').value;
    if (this.accept('op', '=')) {
      const start = this.expr();
      this.expect('op', ',');
      const limit = this.expr();
      const step = this.accept('op', ',') ? this.expr() : null;
      this.expect('kw', 'do');
      const body = this.block();
      this.expect('kw', 'end');
      return { type: 'fornum', name: first, start, limit, step, body };
    }
    const names = [first];
    while (this.accept('op', ',')) names.push(this.expect('name').value);
    this.expect('kw', 'in');
    const iterators = this.exprList();
    this.expect('kw', 'do');
    const body = this.block();
    this.expect('kw', 'end');
    return { type: 'forin', names, iterators, body };
  }

  functionBody(isMethod) {
    this.expect('op', '(');
    const params = isMethod ? ['self'] : [];
    let vararg = false;
    if (!this.is('op', ')')) {
      do {
        if (this.accept('op', '...')) { vararg = true; break; }
        params.push(this.expect('name').value);
      } while (this.accept('op', ','));
    }
    this.expect('op', ')');
    const body = this.block();
    this.expect('kw', 'end');
    return { type: 'func', params, vararg, body };
  }

  exprList() {
    const list = [this.expr()];
    while (this.accept('op', ',')) list.push(this.expr());
    return list;
  }

  expr(limit = 0) {
    let left;
    const t = this.peek();
    if ((t.type === 'kw' && t.value === 'not') || (t.type === 'op' && (t.value === '-' || t.value === '#'))) {
      this.next();
      left = { type: 'unary', op: t.value, operand: this.expr(UNARY_PRECEDENCE) };
    } else {
      left = this.simpleExpression();
    }
    while (true) {
      const op = this.peek();
      const key = op.type === 'kw' || op.type === 'op' ? op.value : null;
      const prec = key && BINARY_PRECEDENCE[key];
      if (!prec || prec[0] <= limit) break;
      this.next();
      const right = this.expr(prec[1]);
      left = key === 'and' || key === 'or' ? { type: key, left, right } : { type: 'binary', op: key, left, right };
    }
    return left;
  }

  simpleExpression() {
    const t = this.peek();
    switch (t.type) {
      case 'num': this.next(); return { type: 'const', value: t.value };
      case 'str': this.next(); return { type: 'const', value: t.value };
      case 'kw':
        if (t.value === 'nil') { this.next(); return { type: 'const', value: undefined }; }
        if (t.value === 'true') { this.next(); return { type: 'const', value: true }; }
        if (t.value === 'false') { this.next(); return { type: 'const', value: false }; }
        if (t.value === 'function') { this.next(); return this.functionBody(false); }
        break;
      case 'op':
        if (t.value === '...') { this.next(); return { type: 'vararg' }; }
        if (t.value === '{') return this.tableConstructor();
        break;
      default: break;
    }
    return this.suffixedExpression();
  }

  primaryExpression() {
    const t = this.peek();
    if (t.type === 'name') { this.next(); return { type: 'name', name: t.value }; }
    if (t.type === 'op' && t.value === '(') {
      this.next();
      const inner = this.expr();
      this.expect('op', ')');
      return { type: 'paren', inner };
    }
    return this.fail('unexpected symbol');
  }

  suffixedExpression() {
    let expression = this.primaryExpression();
    while (true) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '.') { this.next(); expression = { type: 'index', obj: expression, key: { type: 'const', value: this.expect('name').value } }; continue; }
      if (t.type === 'op' && t.value === '[') { this.next(); const key = this.expr(); this.expect('op', ']'); expression = { type: 'index', obj: expression, key }; continue; }
      if (t.type === 'op' && t.value === ':') { this.next(); const name = this.expect('name').value; expression = { type: 'mcall', obj: expression, name, args: this.callArguments() }; continue; }
      if ((t.type === 'op' && (t.value === '(' || t.value === '{')) || t.type === 'str') { expression = { type: 'call', fn: expression, args: this.callArguments() }; continue; }
      return expression;
    }
  }

  callArguments() {
    const t = this.peek();
    if (t.type === 'str') { this.next(); return [{ type: 'const', value: t.value }]; }
    if (t.type === 'op' && t.value === '{') return [this.tableConstructor()];
    this.expect('op', '(');
    if (this.accept('op', ')')) return [];
    const args = this.exprList();
    this.expect('op', ')');
    return args;
  }

  tableConstructor() {
    this.expect('op', '{');
    const items = [];
    while (!this.is('op', '}')) {
      if (this.is('op', '[')) {
        this.next();
        const key = this.expr();
        this.expect('op', ']');
        this.expect('op', '=');
        items.push({ kind: 'keyed', key, value: this.expr() });
      } else if (this.is('name') && this.tokens[this.index + 1].type === 'op' && this.tokens[this.index + 1].value === '=') {
        const name = this.next().value;
        this.next();
        items.push({ kind: 'keyed', key: { type: 'const', value: name }, value: this.expr() });
      } else {
        items.push({ kind: 'positional', value: this.expr() });
      }
      if (!this.accept('op', ',') && !this.accept('op', ';')) break;
    }
    this.expect('op', '}');
    return { type: 'table', items };
  }
}

// ---------- evaluator ----------

class Scope {
  constructor(parent) { this.parent = parent; this.vars = new Map(); this.varargs = parent ? parent.varargs : []; }
  find(name) { for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s; return null; }
}

class LuaFunction {
  constructor(node, scope) { this.node = node; this.scope = scope; }
}

const BREAK = Symbol('break');

function arithmetic(op, a, b) {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === undefined || y === undefined) {
    const bad = x === undefined ? a : b;
    throw new LuaError(`user_script: attempt to perform arithmetic on a ${luaType(bad)} value`);
  }
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return x / y;
    case '%': return y === 0 ? NaN : x - Math.floor(x / y) * y;
    case '^': return x ** y;
    default: throw new LuaError(`unknown operator ${op}`);
  }
}

function compare(op, a, b) {
  if (op === '==') return a === b;
  if (op === '~=') return a !== b;
  const bothNumbers = typeof a === 'number' && typeof b === 'number';
  const bothStrings = typeof a === 'string' && typeof b === 'string';
  if (!bothNumbers && !bothStrings) throw new LuaError(`user_script: attempt to compare ${luaType(a)} with ${luaType(b)}`);
  switch (op) {
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    default: return a >= b;
  }
}

function concat(a, b) {
  const ok = (v) => typeof v === 'string' || typeof v === 'number';
  if (!ok(a) || !ok(b)) throw new LuaError(`user_script: attempt to concatenate a ${luaType(ok(a) ? b : a)} value`);
  return luaToString(a) + luaToString(b);
}

function length(value) {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value instanceof LuaTable) return value.length();
  throw new LuaError(`user_script: attempt to get length of a ${luaType(value)} value`);
}

class Interpreter {
  constructor({ globals, steps = MAX_STEPS }) { this.globals = globals; this.stepsLeft = steps; }

  tick() { this.stepsLeft -= 1; if (this.stepsLeft < 0) throw new LuaError('Script exceeded the maximum number of operations'); }

  getGlobal(name) {
    const value = this.globals.get(name);
    if (value === undefined) throw new LuaError(`user_script: Script attempted to access nonexistent global variable '${name}'`);
    return value;
  }

  index(object, key) {
    if (object instanceof LuaTable) return object.get(key);
    if (typeof object === 'string') return this.globals.get('string')?.get(key);
    throw new LuaError(`user_script: attempt to index a ${luaType(object)} value`);
  }

  async call(fn, args) {
    this.tick();
    if (typeof fn === 'function') return fn(args, this);
    if (fn instanceof LuaFunction) {
      const scope = new Scope(fn.scope);
      fn.node.params.forEach((name, i) => scope.vars.set(name, args[i]));
      scope.varargs = fn.node.vararg ? args.slice(fn.node.params.length) : [];
      const signal = await this.execBlock(fn.node.body, scope);
      return signal && signal !== BREAK ? signal.values : [];
    }
    throw new LuaError(`user_script: attempt to call a ${luaType(fn)} value`);
  }

  async evalMulti(node, scope) {
    if (node.type === 'call' || node.type === 'mcall') return this.evalCall(node, scope);
    if (node.type === 'vararg') return scope.varargs;
    return [await this.eval(node, scope)];
  }

  async evalList(nodes, scope) {
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      if (i === nodes.length - 1) out.push(...await this.evalMulti(nodes[i], scope));
      else out.push(await this.eval(nodes[i], scope));
    }
    return out;
  }

  async evalCall(node, scope) {
    if (node.type === 'mcall') {
      const object = await this.eval(node.obj, scope);
      const fn = this.index(object, node.name);
      return this.call(fn, [object, ...await this.evalList(node.args, scope)]);
    }
    const fn = await this.eval(node.fn, scope);
    return this.call(fn, await this.evalList(node.args, scope));
  }

  async eval(node, scope) {
    this.tick();
    switch (node.type) {
      case 'const': return node.value;
      case 'vararg': return scope.varargs[0];
      case 'name': {
        const owner = scope.find(node.name);
        return owner ? owner.vars.get(node.name) : this.getGlobal(node.name);
      }
      case 'paren': return (await this.evalMulti(node.inner, scope))[0];
      case 'index': return this.index(await this.eval(node.obj, scope), await this.eval(node.key, scope));
      case 'call': case 'mcall': return (await this.evalCall(node, scope))[0];
      case 'func': return new LuaFunction(node, scope);
      case 'and': { const left = await this.eval(node.left, scope); return truthy(left) ? this.eval(node.right, scope) : left; }
      case 'or': { const left = await this.eval(node.left, scope); return truthy(left) ? left : this.eval(node.right, scope); }
      case 'unary': {
        const value = await this.eval(node.operand, scope);
        if (node.op === 'not') return !truthy(value);
        if (node.op === '#') return length(value);
        const n = toNumber(value);
        if (n === undefined) throw new LuaError(`user_script: attempt to perform arithmetic on a ${luaType(value)} value`);
        return -n;
      }
      case 'binary': {
        const left = await this.eval(node.left, scope);
        const right = await this.eval(node.right, scope);
        if (node.op === '..') return concat(left, right);
        if (['==', '~=', '<', '>', '<=', '>='].includes(node.op)) return compare(node.op, left, right);
        return arithmetic(node.op, left, right);
      }
      case 'table': {
        const table = new LuaTable();
        let position = 1;
        for (let i = 0; i < node.items.length; i += 1) {
          const item = node.items[i];
          if (item.kind === 'keyed') { table.set(await this.eval(item.key, scope), await this.eval(item.value, scope)); continue; }
          if (i === node.items.length - 1) {
            for (const value of await this.evalMulti(item.value, scope)) { if (value !== undefined) table.set(position, value); position += 1; }
          } else {
            const value = await this.eval(item.value, scope);
            if (value !== undefined) table.set(position, value);
            position += 1;
          }
        }
        return table;
      }
      default: throw new LuaError(`user_script: unsupported expression '${node.type}'`);
    }
  }

  assign(target, value, scope, evaluatedTarget) {
    if (target.type === 'name') {
      const owner = scope.find(target.name);
      if (!owner) throw new LuaError(`user_script: Script attempted to create global variable '${target.name}'`);
      owner.vars.set(target.name, value);
      return;
    }
    const { object, key } = evaluatedTarget;
    if (!(object instanceof LuaTable)) throw new LuaError(`user_script: attempt to index a ${luaType(object)} value`);
    object.set(key, value);
  }

  async execBlock(statements, parentScope) {
    const scope = new Scope(parentScope);
    for (const statement of statements) {
      const signal = await this.exec(statement, scope);
      if (signal) return signal;
    }
    return undefined;
  }

  async exec(node, scope) {
    this.tick();
    switch (node.type) {
      case 'local': {
        const values = await this.evalList(node.values, scope);
        node.names.forEach((name, i) => scope.vars.set(name, values[i]));
        return undefined;
      }
      case 'localfunction': {
        scope.vars.set(node.name, undefined);
        scope.vars.set(node.name, new LuaFunction(node.func, scope));
        return undefined;
      }
      case 'assign': {
        const evaluated = [];
        for (const target of node.targets) {
          evaluated.push(target.type === 'index' ? { object: await this.eval(target.obj, scope), key: await this.eval(target.key, scope) } : null);
        }
        const values = await this.evalList(node.values, scope);
        node.targets.forEach((target, i) => this.assign(target, values[i], scope, evaluated[i]));
        return undefined;
      }
      case 'callstat': await this.evalCall(node.call, scope); return undefined;
      case 'do': return this.execBlock(node.body, scope);
      case 'if': {
        for (const clause of node.clauses) if (truthy(await this.eval(clause.cond, scope))) return this.execBlock(clause.body, scope);
        return node.elseBody ? this.execBlock(node.elseBody, scope) : undefined;
      }
      case 'while': {
        while (truthy(await this.eval(node.cond, scope))) {
          const signal = await this.execBlock(node.body, scope);
          if (signal === BREAK) break;
          if (signal) return signal;
        }
        return undefined;
      }
      case 'repeat': {
        while (true) {
          const inner = new Scope(scope);
          let signal;
          for (const statement of node.body) { signal = await this.exec(statement, inner); if (signal) break; }
          if (signal === BREAK) break;
          if (signal) return signal;
          if (truthy(await this.eval(node.cond, inner))) break;
        }
        return undefined;
      }
      case 'fornum': {
        const start = toNumber(await this.eval(node.start, scope));
        const limit = toNumber(await this.eval(node.limit, scope));
        const step = node.step ? toNumber(await this.eval(node.step, scope)) : 1;
        if (start === undefined) throw new LuaError("user_script: 'for' initial value must be a number");
        if (limit === undefined) throw new LuaError("user_script: 'for' limit must be a number");
        if (step === undefined) throw new LuaError("user_script: 'for' step must be a number");
        if (step === 0) throw new LuaError("user_script: 'for' step is zero");
        for (let i = start; step > 0 ? i <= limit : i >= limit; i += step) {
          const inner = new Scope(scope);
          inner.vars.set(node.name, i);
          let signal;
          for (const statement of node.body) { signal = await this.exec(statement, inner); if (signal) break; }
          if (signal === BREAK) break;
          if (signal) return signal;
        }
        return undefined;
      }
      case 'forin': {
        const [iterator, state, initial] = await this.evalList(node.iterators, scope);
        let control = initial;
        while (true) {
          const results = await this.call(iterator, [state, control]);
          if (results[0] === undefined) break;
          control = results[0];
          const inner = new Scope(scope);
          node.names.forEach((name, i) => inner.vars.set(name, results[i]));
          let signal;
          for (const statement of node.body) { signal = await this.exec(statement, inner); if (signal) break; }
          if (signal === BREAK) break;
          if (signal) return signal;
        }
        return undefined;
      }
      case 'return': return { values: await this.evalList(node.values, scope) };
      case 'break': return BREAK;
      default: throw new LuaError(`user_script: unsupported statement '${node.type}'`);
    }
  }
}

// ---------- standard library ----------

function need(args, n, name) {
  if (n >= args.length) throw new LuaError(`user_script: bad argument #${n + 1} to '${name}' (value expected)`);
  return args[n];
}

function numberArg(args, n, name) {
  const value = toNumber(args[n]);
  if (value === undefined) throw new LuaError(`user_script: bad argument #${n + 1} to '${name}' (number expected, got ${luaType(args[n])})`);
  return value;
}

function stringArg(args, n, name) {
  const v = args[n];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return luaToString(v);
  throw new LuaError(`user_script: bad argument #${n + 1} to '${name}' (string expected, got ${luaType(v)})`);
}

function luaSub(s, i, j) {
  const len = s.length;
  let from = i < 0 ? Math.max(len + i + 1, 1) : (i === 0 ? 1 : i);
  let to = j < 0 ? len + j + 1 : Math.min(j, len);
  if (from > to) return '';
  return s.slice(from - 1, to);
}

function libTable(entries) {
  const table = new LuaTable();
  for (const [name, fn] of Object.entries(entries)) table.set(name, fn);
  return table;
}

// ---------- cjson ----------

const JSON_ESCAPES = { '"': '\\"', '\\': '\\\\', '/': '\\/', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function encodeString(s) {
  return `"${s.replace(/["\\/\u0000-\u001f\u007f]/g, (ch) => JSON_ESCAPES[ch] || `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

export function cjsonEncode(value, depth = 0) {
  if (depth > 1000) throw new LuaError('Cannot serialise, excessive nesting (1001)');
  if (value === NULL) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') return encodeString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LuaError('Cannot serialise number: must not be NaN or Inf');
    return formatG(value, 14);
  }
  if (value instanceof LuaTable) {
    const keys = value.keys();
    if (keys.length === 0) return '{}';
    const isArray = keys.every((k) => typeof k === 'number' && Number.isInteger(k) && k >= 1);
    if (isArray) {
      const max = Math.max(...keys);
      if (max > 10 && max > keys.length * 2) throw new LuaError('Cannot serialise table: excessively sparse array');
      const parts = [];
      for (let i = 1; i <= max; i += 1) parts.push(value.get(i) === undefined ? 'null' : cjsonEncode(value.get(i), depth + 1));
      return `[${parts.join(',')}]`;
    }
    const parts = [];
    for (const key of keys) {
      if (typeof key !== 'string' && typeof key !== 'number') throw new LuaError('Cannot serialise table: table key must be a number or string');
      parts.push(`${encodeString(typeof key === 'number' ? formatG(key, 14) : key)}:${cjsonEncode(value.get(key), depth + 1)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new LuaError(`Cannot serialise ${luaType(value)}: type not supported`);
}

function fromJson(value) {
  if (value === null) return NULL;
  if (Array.isArray(value)) return tableFrom(value.map(fromJson));
  if (value && typeof value === 'object') {
    const table = new LuaTable();
    for (const [k, v] of Object.entries(value)) table.set(k, fromJson(v));
    return table;
  }
  return value;
}

export function cjsonDecode(text) {
  try { return fromJson(JSON.parse(text)); } catch { throw new LuaError('Expected value but found invalid token'); }
}

// ---------- Redis <-> Lua value conversion ----------

export function redisArg(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatG(value, 17);
  throw new LuaError('Lua redis() command arguments must be strings or integers');
}

export function replyToLua(reply) {
  if (reply === null || reply === undefined) return false;
  if (Array.isArray(reply)) return tableFrom(reply.map((item) => replyToLua(item)));
  return reply;
}

export class ScriptReplyError extends Error {}

export function luaToReply(value) {
  if (value === undefined || value === false || value === NULL) return null;
  if (value === true) return 1;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'string') return value;
  if (value instanceof LuaTable) {
    const err = value.get('err');
    if (typeof err === 'string') throw new ScriptReplyError(err);
    const ok = value.get('ok');
    if (typeof ok === 'string') return ok;
    const out = [];
    for (let i = 1; value.get(i) !== undefined; i += 1) out.push(luaToReply(value.get(i)));
    return out;
  }
  return null;
}

// ---------- public API ----------

export function parseLua(source) {
  return new Parser(tokenize(source)).parseChunk();
}

const parsedCache = new Map();

function parseCached(source) {
  let ast = parsedCache.get(source);
  if (!ast) {
    ast = parseLua(source);
    if (parsedCache.size > 200) parsedCache.clear();
    parsedCache.set(source, ast);
  }
  return ast;
}

// Runs `script` with KEYS and ARGV. `redisCall(args: string[])` runs one Redis command and returns its reply in
// the shape the REST API uses (number, string, null or array); it may throw, and the error aborts the script.
export async function runScript(script, { keys = [], argv = [], redisCall, maxSteps = MAX_STEPS }) {
  const globals = new LuaTable();
  const interpreter = new Interpreter({ globals, steps: maxSteps });

  const luaCall = (pcall) => async (args) => {
    if (!args.length) throw new LuaError('user_script: Please specify at least one argument for redis.call()');
    const command = args.map(redisArg);
    try {
      return [replyToLua(await redisCall(command))];
    } catch (error) {
      if (!pcall) throw new LuaError(error.message);
      const table = new LuaTable();
      table.set('err', error.message);
      return [table];
    }
  };

  const redisTable = libTable({
    call: luaCall(false),
    pcall: luaCall(true),
    error_reply: (args) => { const t = new LuaTable(); t.set('err', stringArg(args, 0, 'error_reply')); return [t]; },
    status_reply: (args) => { const t = new LuaTable(); t.set('ok', stringArg(args, 0, 'status_reply')); return [t]; },
    sha1hex: (args) => [crypto.createHash('sha1').update(stringArg(args, 0, 'sha1hex')).digest('hex')],
    log: () => [],
    replicate_commands: () => [true],
    set_repl: () => [],
  });
  for (const [name, value] of Object.entries({ LOG_DEBUG: 0, LOG_VERBOSE: 1, LOG_NOTICE: 2, LOG_WARNING: 3, REPL_NONE: 0, REPL_AOF: 1, REPL_SLAVE: 2, REPL_REPLICA: 2, REPL_ALL: 3 })) redisTable.set(name, value);

  const mathTable = libTable({
    max: (args) => { let best = numberArg(args, 0, 'max'); for (let i = 1; i < args.length; i += 1) best = Math.max(best, numberArg(args, i, 'max')); return [best]; },
    min: (args) => { let best = numberArg(args, 0, 'min'); for (let i = 1; i < args.length; i += 1) best = Math.min(best, numberArg(args, i, 'min')); return [best]; },
    floor: (args) => [Math.floor(numberArg(args, 0, 'floor'))],
    ceil: (args) => [Math.ceil(numberArg(args, 0, 'ceil'))],
    abs: (args) => [Math.abs(numberArg(args, 0, 'abs'))],
    sqrt: (args) => [Math.sqrt(numberArg(args, 0, 'sqrt'))],
    fmod: (args) => [numberArg(args, 0, 'fmod') % numberArg(args, 1, 'fmod')],
    pow: (args) => [numberArg(args, 0, 'pow') ** numberArg(args, 1, 'pow')],
  });
  mathTable.set('huge', Infinity);
  mathTable.set('pi', Math.PI);

  const stringTable = libTable({
    len: (args) => [Buffer.byteLength(stringArg(args, 0, 'len'))],
    sub: (args) => [luaSub(stringArg(args, 0, 'sub'), numberArg(args, 1, 'sub'), args[2] === undefined ? -1 : numberArg(args, 2, 'sub'))],
    lower: (args) => [stringArg(args, 0, 'lower').toLowerCase()],
    upper: (args) => [stringArg(args, 0, 'upper').toUpperCase()],
    rep: (args) => [stringArg(args, 0, 'rep').repeat(Math.max(0, numberArg(args, 1, 'rep')))],
    format: (args) => {
      let next = 1;
      return [stringArg(args, 0, 'format').replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([dsfgxXc%])/g, (m, flags, width, precision, kind) => {
        if (kind === '%') return '%';
        const value = args[next]; next += 1;
        let text;
        if (kind === 's') text = luaToString(value);
        else if (kind === 'd') text = String(Math.trunc(Number(toNumber(value))));
        else if (kind === 'f') text = Number(toNumber(value)).toFixed(precision === undefined ? 6 : Number(precision));
        else if (kind === 'g') text = formatG(Number(toNumber(value)), precision === undefined ? 6 : Number(precision));
        else if (kind === 'x') text = Math.trunc(Number(toNumber(value))).toString(16);
        else if (kind === 'X') text = Math.trunc(Number(toNumber(value))).toString(16).toUpperCase();
        else text = String.fromCharCode(Number(toNumber(value)));
        if (width) text = flags.includes('-') ? text.padEnd(Number(width)) : text.padStart(Number(width), flags.includes('0') && kind !== 's' ? '0' : ' ');
        return text;
      })];
    },
  });

  const tableTable = libTable({
    insert: (args) => {
      const t = args[0];
      if (!(t instanceof LuaTable)) throw new LuaError("user_script: bad argument #1 to 'insert' (table expected)");
      if (args.length === 2) { t.set(t.length() + 1, args[1]); return []; }
      const pos = numberArg(args, 1, 'insert');
      for (let i = t.length(); i >= pos; i -= 1) t.set(i + 1, t.get(i));
      t.set(pos, args[2]);
      return [];
    },
    remove: (args) => {
      const t = args[0];
      const n = t.length();
      const pos = args[1] === undefined ? n : numberArg(args, 1, 'remove');
      const removed = t.get(pos);
      for (let i = pos; i < n; i += 1) t.set(i, t.get(i + 1));
      if (n > 0) t.set(n, undefined);
      return [removed];
    },
    concat: (args) => {
      const t = args[0];
      const sep = args[1] === undefined ? '' : stringArg(args, 1, 'concat');
      const from = args[2] === undefined ? 1 : numberArg(args, 2, 'concat');
      const to = args[3] === undefined ? t.length() : numberArg(args, 3, 'concat');
      const parts = [];
      for (let i = from; i <= to; i += 1) parts.push(stringArg([t.get(i)], 0, 'concat'));
      return [parts.join(sep)];
    },
    getn: (args) => [args[0].length()],
  });

  const cjsonTable = libTable({
    encode: (args) => [cjsonEncode(need(args, 0, 'encode'))],
    decode: (args) => [cjsonDecode(stringArg(args, 0, 'decode'))],
  });
  cjsonTable.set('null', NULL);

  const unpack = (args) => {
    const t = args[0];
    const from = args[1] === undefined ? 1 : numberArg(args, 1, 'unpack');
    const to = args[2] === undefined ? t.length() : numberArg(args, 2, 'unpack');
    const out = [];
    for (let i = from; i <= to; i += 1) out.push(t.get(i));
    return out;
  };

  const base = {
    tonumber: (args) => {
      const v = args[0];
      if (args[1] !== undefined) { const parsed = parseInt(String(v), numberArg(args, 1, 'tonumber')); return [Number.isNaN(parsed) ? undefined : parsed]; }
      return [toNumber(v)];
    },
    tostring: (args) => [luaToString(args[0])],
    type: (args) => [luaType(need(args, 0, 'type'))],
    ipairs: (args) => {
      const t = args[0];
      if (!(t instanceof LuaTable)) throw new LuaError("user_script: bad argument #1 to 'ipairs' (table expected)");
      return [(innerArgs) => { const i = innerArgs[1] + 1; const v = t.get(i); return v === undefined ? [undefined] : [i, v]; }, t, 0];
    },
    pairs: (args) => {
      const t = args[0];
      if (!(t instanceof LuaTable)) throw new LuaError("user_script: bad argument #1 to 'pairs' (table expected)");
      const snapshot = t.keys();
      let cursor = 0;
      return [() => {
        while (cursor < snapshot.length) {
          const key = snapshot[cursor]; cursor += 1;
          const value = t.get(key);
          if (value !== undefined) return [key, value];
        }
        return [undefined];
      }, t, undefined];
    },
    next: (args) => {
      const t = args[0];
      const keys = t.keys();
      let start = 0;
      if (args[1] !== undefined) start = keys.indexOf(args[1]) + 1;
      for (let i = start; i < keys.length; i += 1) { const v = t.get(keys[i]); if (v !== undefined) return [keys[i], v]; }
      return [undefined];
    },
    select: (args) => {
      if (args[0] === '#') return [args.length - 1];
      const n = numberArg(args, 0, 'select');
      return n < 0 ? args.slice(args.length + n) : args.slice(n);
    },
    unpack,
    error: (args) => { throw new LuaError(typeof args[0] === 'string' ? `user_script: ${args[0]}` : luaToString(args[0])); },
    assert: (args) => { if (!truthy(args[0])) throw new LuaError(args[1] === undefined ? 'assertion failed!' : luaToString(args[1])); return args; },
    pcall: async (args, interp) => {
      try { return [true, ...await interp.call(args[0], args.slice(1))]; } catch (error) {
        if (error instanceof LuaError) return [false, error.message];
        throw error;
      }
    },
    rawget: (args) => [args[0].get(args[1])],
    rawset: (args) => { args[0].set(args[1], args[2]); return [args[0]]; },
  };

  for (const [name, fn] of Object.entries(base)) globals.set(name, fn);
  globals.set('redis', redisTable);
  globals.set('math', mathTable);
  globals.set('string', stringTable);
  globals.set('table', tableTable);
  globals.set('cjson', cjsonTable);
  globals.set('KEYS', tableFrom(keys.map(String)));
  globals.set('ARGV', tableFrom(argv.map(String)));

  const ast = parseCached(script);
  const scope = new Scope(null);
  const signal = await interpreter.execBlock(ast, scope);
  const values = signal && signal !== BREAK ? signal.values : [];
  return luaToReply(values[0]);
}
