const prefixes = /(?<!\w)(?:sk-(?:ant-)?|ghp[_]|github[_]pat[_]|AKIA|xox|eyJ|-----BEGI[N])[A-Za-z0-9_./+=-]*/g;
const emails = /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;
const mixed = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}\b/g;
const versions = /\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/g;

export function mask(text, profile) {
  const hidden = text.replace(prefixes, '[hidden]').replace(emails, '[hidden]');
  return profile === 'display'
    ? hidden.replace(mixed, '[hidden]').replace(versions, '[hidden]')
    : hidden;
}
