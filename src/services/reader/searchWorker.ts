import type { ReaderSearchResult } from './types';

type StartMessage = {
  type: 'start';
  token: number;
  query: string;
  maxResults: number;
  maxPerSection: number;
  excerptRadius: number;
};

type SectionMessage = {
  type: 'section';
  token: number;
  cfiBase: string;
  section: string;
  text: string;
};

type FinishMessage = { type: 'finish'; token: number };
type CancelMessage = { type: 'cancel'; token: number };

type InMessage = StartMessage | SectionMessage | FinishMessage | CancelMessage;

type ResultMessage = { type: 'result'; token: number; result: ReaderSearchResult };
type DoneMessage = { type: 'done'; token: number };

type OutMessage = ResultMessage | DoneMessage;

let currentToken = 0;
let query = '';
let maxResults = 50;
let maxPerSection = 3;
let excerptRadius = 50;
let total = 0;
let stopped = false;
let sectionCounts = new Map<string, number>();

function reset(start: StartMessage) {
  currentToken = start.token;
  query = start.query.toLowerCase();
  maxResults = start.maxResults;
  maxPerSection = start.maxPerSection;
  excerptRadius = start.excerptRadius;
  total = 0;
  stopped = false;
  sectionCounts = new Map<string, number>();
}

function emit(msg: OutMessage) {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (ev: MessageEvent<InMessage>) => {
  const msg = ev.data;

  if (msg.type === 'start') {
    reset(msg);
    return;
  }

  if (msg.token !== currentToken) return;

  if (msg.type === 'cancel') {
    stopped = true;
    return;
  }

  if (msg.type === 'finish') {
    emit({ type: 'done', token: currentToken });
    return;
  }

  if (stopped || !query) return;

  const sectionKey = msg.section || msg.cfiBase;
  const count = sectionCounts.get(sectionKey) ?? 0;
  if (count >= maxPerSection) return;

  const lower = msg.text.toLowerCase();
  let searchIndex = 0;
  let found = lower.indexOf(query, searchIndex);
  while (found !== -1 && total < maxResults) {
    const nextCount = sectionCounts.get(sectionKey) ?? 0;
    if (nextCount >= maxPerSection) break;

    const start = Math.max(0, found - excerptRadius);
    const end = Math.min(msg.text.length, found + query.length + excerptRadius);
    let excerpt = msg.text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) excerpt = '...' + excerpt;
    if (end < msg.text.length) excerpt = excerpt + '...';

    emit({
      type: 'result',
      token: currentToken,
      result: {
        cfi: msg.cfiBase,
        excerpt,
        section: msg.section,
      },
    });

    total += 1;
    sectionCounts.set(sectionKey, nextCount + 1);

    if (total >= maxResults) {
      stopped = true;
      break;
    }

    searchIndex = found + query.length;
    found = lower.indexOf(query, searchIndex);
  }
};
