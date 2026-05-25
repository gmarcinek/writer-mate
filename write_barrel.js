const fs = require('fs');
const content = `export {
  readerOrchestrationInputSchema,
  runReaderOrchestration,
  type ReaderOrchestrationInput,
  type ReaderOrchestrationResult,
  type RunReaderOrchestrationOptions,
  type ReaderOrchestrationStage,
} from './orchestration/index';
`;
fs.writeFileSync('c:/projects/writer-mate/src/lib/reader/orchestration.ts', content, 'utf8');
console.log('done');
