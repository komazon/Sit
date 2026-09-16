import { diffProjects, formatDiff } from './diff.js';

// Test with two simple project.json objects
const oldProject = {
  targets: [
    {
      isStage: false,
      name: 'Sprite1',
      blocks: {
        'test1': {
          opcode: 'event_whenflagclicked',
          topLevel: true,
          next: null,
          fields: {},
          inputs: {},
          mutation: null
        }
      },
      variables: {},
      lists: {},
      costumes: [],
      sounds: []
    }
  ]
};

const newProject = {
  targets: [
    {
      isStage: false,
      name: 'Sprite1',
      blocks: {
        'test1': {
          opcode: 'event_whenflagclicked',
          topLevel: true,
          next: 'test2',
          fields: {},
          inputs: {},
          mutation: null
        },
        'test2': {
          opcode: 'motion_movesteps',
          topLevel: false,
          next: null,
          fields: { STEPS: [10, 'STEPS'] },
          inputs: { STEPS: [1, [4, '10']] },
          mutation: null
        }
      },
      variables: {},
      lists: {},
      costumes: [],
      sounds: []
    }
  ]
};

try {
  const diffs = diffProjects(oldProject, newProject, 'en');
  console.log('diffProjects result:', JSON.stringify(diffs, null, 2));
  console.log('\n--- Formatted Diff ---\n');
  console.log(formatDiff(diffs));
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
}
