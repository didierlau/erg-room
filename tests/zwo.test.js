import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseZwo, toZwo, ZwoError } from '../src/workout/zwo.js';

// Stand-in for the browser's DOMParser path: any XML error becomes a ZwoError.
const parseXml = (text) => {
  try {
    return new DOMParser({ onError: (level) => { if (level !== 'warning') throw new Error('xml'); } }).parseFromString(text, 'text/xml');
  } catch {
    throw new ZwoError("isn't valid XML");
  }
};
const parse = (text, name = 'file.zwo') => parseZwo(text, name, parseXml);

const SAMPLE = `<workout_file>
  <author>Coach</author><name>Over-unders</name><description>Hard &amp; short</description>
  <workout>
    <Warmup Duration="300" PowerLow="0.4" PowerHigh="0.7"/>
    <SteadyState Duration="120" Power="0.8" Cadence="90"><textevent timeoffset="10" message="Go"/></SteadyState>
    <IntervalsT Repeat="3" OnDuration="60" OffDuration="30" OnPower="1.2" OffPower="0.5"/>
    <FreeRide Duration="60" FlatRoad="1"/>
    <MaxEffort Duration="20"/>
    <Cooldown Duration="200" PowerLow="0.6" PowerHigh="0.4"/>
  </workout>
</workout_file>`;

test('parses every supported step type', () => {
  const w = parse(SAMPLE);
  assert.equal(w.name, 'Over-unders');
  assert.equal(w.description, 'Hard & short');
  assert.deepEqual(w.blocks, [
    { t: 'ramp', d: 300, p1: 0.4, p2: 0.7 },
    { t: 'steady', d: 120, p: 0.8 },
    { t: 'intervals', n: 3, on: 60, onP: 1.2, off: 30, offP: 0.5 },
    { t: 'free', d: 60 },
    { t: 'free', d: 20 },
    { t: 'ramp', d: 200, p1: 0.6, p2: 0.4 },
  ]);
});

test('SteadyState with PowerLow/PowerHigh uses the midpoint; flat warmup becomes steady', () => {
  const w = parse('<workout_file><workout><SteadyState Duration="60" PowerLow="0.6" PowerHigh="0.8"/><Warmup Duration="60" PowerLow="0.5" PowerHigh="0.5"/></workout></workout_file>');
  assert.ok(Math.abs(w.blocks[0].p - 0.7) < 1e-9);
  assert.deepEqual(w.blocks[1], { t: 'steady', d: 60, p: 0.5 });
});

test('falls back to the file name when there is no <name>', () => {
  assert.equal(parse('<workout_file><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>', 'Tempo Tuesday.zwo').name, 'Tempo Tuesday');
});

test('rejects files without usable steps', () => {
  assert.throws(() => parse('<workout_file><name>x</name></workout_file>'), /no <workout>/);
  assert.throws(() => parse('<workout_file><workout><textevent/></workout></workout_file>'), /no workout steps/);
  assert.throws(() => parse('<workout_file><workout>'), ZwoError);
});

test('export then import gives the same blocks', () => {
  const original = parse(SAMPLE);
  original.blocks = original.blocks.filter((b, i) => i !== 4); // MaxEffort exports as FreeRide
  const xml = toZwo(original);
  assert.match(xml, /<Warmup Duration="300"/);
  assert.match(xml, /<Cooldown Duration="200"/);
  assert.deepEqual(parse(xml).blocks, original.blocks);
  assert.match(toZwo({ name: 'A & B <1>', blocks: [{ t: 'steady', d: 1, p: 1 }] }), /<name>A &amp; B &lt;1&gt;<\/name>/);
});
