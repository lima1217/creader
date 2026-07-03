import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const assistantDir = path.join(root, 'reading-assistant');
const skillsDir = path.join(assistantDir, 'skills');

const requiredSkills = new Map([
  ['explain-selection', ['selected-passage-question.json', 'source-boundary-caution.json']],
  ['answer-from-reading-context', ['chapter-context-question.json']],
  ['save-reading-memory', [
    'explicit-save-request.json',
    'ordinary-summary-skip.json',
    'low-value-follow-up-skip.json',
  ]],
]);

const requiredInstructionPhrases = [
  'src-tauri/prompts/reading_ai_system.md',
  'buildChatRequest',
  'buildReadingMemoryIngestInput',
  'renderReadingMemoryNoteMarkdown',
];

async function assertFile(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`${relative(filePath)} is not a file`);
  }
}

async function readRequiredText(filePath) {
  await assertFile(filePath);
  const value = await readFile(filePath, 'utf8');
  if (!value.trim()) {
    throw new Error(`${relative(filePath)} is empty`);
  }
  return value;
}

function relative(filePath) {
  return path.relative(root, filePath);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertFixtureShape(filePath, fixture, skillName) {
  assert(fixture && typeof fixture === 'object', `${relative(filePath)} must contain a JSON object`);
  assert(typeof fixture.name === 'string' && fixture.name.length > 0, `${relative(filePath)} missing name`);
  assert(fixture.skill === skillName, `${relative(filePath)} skill must be ${skillName}`);
  assert(typeof fixture.scenario === 'string' && fixture.scenario.length > 0, `${relative(filePath)} missing scenario`);
  assert(fixture.input && typeof fixture.input === 'object', `${relative(filePath)} missing input object`);
  assert(fixture.expected && typeof fixture.expected === 'object', `${relative(filePath)} missing expected object`);

  const input = fixture.input;
  assert(input.book && typeof input.book.title === 'string', `${relative(filePath)} input.book.title is required`);
  assert(typeof input.userQuestion === 'string' && input.userQuestion.length > 0, `${relative(filePath)} input.userQuestion is required`);

  if (skillName === 'save-reading-memory') {
    const decision = fixture.expected.decision;
    assert(decision && typeof decision === 'object', `${relative(filePath)} expected.decision is required`);
    assert(typeof decision.should_ingest === 'boolean', `${relative(filePath)} decision.should_ingest must be boolean`);
    if (decision.should_ingest) {
      assert(decision.target_dir, `${relative(filePath)} saved decisions need target_dir`);
      assert(decision.note_type, `${relative(filePath)} saved decisions need note_type`);
      assert(Array.isArray(fixture.expected.noteMustInclude), `${relative(filePath)} saved decisions need noteMustInclude`);
    }
  } else {
    assert(Array.isArray(fixture.expected.answerMust), `${relative(filePath)} expected.answerMust is required`);
    assert(Array.isArray(fixture.expected.answerMustNot), `${relative(filePath)} expected.answerMustNot is required`);
    assert(
      fixture.expected.readingMemory && typeof fixture.expected.readingMemory.shouldIngest === 'boolean',
      `${relative(filePath)} expected.readingMemory.shouldIngest is required`,
    );
  }
}

async function main() {
  const instructions = await readRequiredText(path.join(assistantDir, 'instructions.md'));
  for (const phrase of requiredInstructionPhrases) {
    assert(instructions.includes(phrase), `instructions.md must document parity with ${phrase}`);
  }

  const skillNames = await readdir(skillsDir);
  for (const skillName of requiredSkills.keys()) {
    assert(skillNames.includes(skillName), `missing skill directory ${skillName}`);

    const skillDir = path.join(skillsDir, skillName);
    const skillDoc = await readRequiredText(path.join(skillDir, `${skillName}.md`));
    assert(skillDoc.includes('# '), `${skillName}.md needs a heading`);

    const evalDir = path.join(skillDir, 'evals');
    const evalNames = await readdir(evalDir);
    for (const fixtureName of requiredSkills.get(skillName)) {
      assert(evalNames.includes(fixtureName), `missing ${skillName}/evals/${fixtureName}`);
      const fixturePath = path.join(evalDir, fixtureName);
      const fixture = JSON.parse(await readRequiredText(fixturePath));
      assertFixtureShape(fixturePath, fixture, skillName);
    }
  }
}

main()
  .then(() => {
    console.log('reading-assistant behavior package verified');
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
