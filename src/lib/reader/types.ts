export enum ReaderSourceType {
  BookRawContent = "book_raw_content",
  Document = "document",
  Chunk = "chunk",
}

export enum ReaderSessionStatus {
  Pending = "pending",
  Recon = "recon",
  Reading = "reading",
  Synthesizing = "synthesizing",
  Complete = "complete",
  Partial = "partial",
  Failed = "failed",
  Cancelled = "cancelled",
}

export enum ReaderMode {
  GoalDirected = "goal_directed",
  Exhaustive = "exhaustive",
}

export enum ReaderIntentType {
  ExhaustiveRead = "exhaustive_read",
  QuestionAnswering = "question_answering",
  TargetedExtraction = "targeted_extraction",
  Analysis = "analysis",
  StructureSurvey = "structure_survey",
}

export interface ReaderIntent {
  intentType: ReaderIntentType;
  /** Clear restatement of what the user ultimately wants to achieve. */
  strategicGoal: string;
  /** Ordered intermediate steps to reach the strategic goal. */
  intermediateGoals: string[];
  /** Specific topics, entities, or sections to prioritise. */
  focusAreas: string[];
  /** What can safely be skipped or treated superficially. */
  skipHeuristics: string[];
  /** Textual signals that warrant extra attention (definitions, claims, etc.). */
  prioritySignals: string[];
}

export enum ReaderReconContentType {
  Narrative = "narrative",
  TechnicalDocumentation = "technical_documentation",
  LegalFormal = "legal_formal",
  LogsDiagnostics = "logs_diagnostics",
  TabularRecordLike = "tabular_record_like",
  CodeConfig = "code_config",
  Mixed = "mixed",
}

export enum ReaderReconStrategyHint {
  SequentialChunks = "sequential_chunks",
  SectionBySection = "section_by_section",
  TargetedSearch = "targeted_search",
  ClusteredInvestigation = "clustered_investigation",
  RecordSampling = "record_sampling",
  Hybrid = "hybrid",
}

export enum ReaderCoverageDisposition {
  Read = "read",
  Sampled = "sampled",
  Skipped = "skipped",
}

export enum ReaderCoverageReason {
  SequentialRead = "sequential_read",
  TargetedSearch = "targeted_search",
  ReconSample = "recon_sample",
  ManualJump = "manual_jump",
  DuplicateContent = "duplicate_content",
  OutOfScope = "out_of_scope",
  BudgetLimit = "budget_limit",
  ToolLimit = "tool_limit",
  ErrorRecovery = "error_recovery",
  UserInstruction = "user_instruction",
}

export enum ReaderNoteStatus {
  Active = "active",
  CompleteForNow = "complete_for_now",
  Superseded = "superseded",
}

export enum ReaderHandoffStatus {
  Complete = "complete",
  Partial = "partial",
}

export enum ReaderCheckpointKind {
  Interim = "interim",
  Final = "final",
}

export enum ReaderEvidenceKind {
  DirectRead = "direct_read",
  Sample = "sample",
  SearchHit = "search_hit",
  StructuralMetadata = "structural_metadata",
  Inference = "inference",
}

export enum ReaderStatementKind {
  Fact = "fact",
  Inference = "inference",
  OpenQuestion = "open_question",
}

interface ReaderSourceRefBase {
  sourceType: ReaderSourceType;
  title?: string;
}

export interface ReaderBookSourceRef extends ReaderSourceRefBase {
  sourceId: string;
  sourceType: ReaderSourceType.BookRawContent;
  bookId: string;
  documentId?: null;
  chunkId?: null;
}

export interface ReaderDocumentSourceRef extends ReaderSourceRefBase {
  sourceId: string;
  sourceType: ReaderSourceType.Document;
  documentId: string;
  bookId?: string | null;
  chunkId?: null;
}

export interface ReaderChunkSourceRef extends ReaderSourceRefBase {
  sourceId: string;
  sourceType: ReaderSourceType.Chunk;
  chunkId: string;
  documentId: string;
  bookId?: string | null;
}

export type ReaderSourceRef =
  | ReaderBookSourceRef
  | ReaderDocumentSourceRef
  | ReaderChunkSourceRef;

export interface ReaderLineRange {
  startLine: number;
  endLine: number;
}

export interface ReaderCharacterRange {
  startOffset: number;
  endOffset: number;
}

export interface ReaderRangeRef extends ReaderLineRange {
  startOffset?: number;
  endOffset?: number;
}

export interface ReaderReconStats {
  totalLines: number;
  totalCharacters: number;
  averageLineLength: number;
  nonEmptyLines: number;
  emptyLines: number;
  longestLineLength: number;
}

export interface ReaderReconHeading {
  line: number;
  level: number;
  text: string;
  slug: string;
}

export interface ReaderReconSample extends ReaderRangeRef {
  label: string;
  excerpt: string;
  charCount: number;
}

export interface ReaderReconClassification {
  primaryType: ReaderReconContentType;
  secondaryTypes: ReaderReconContentType[];
  suggestedStrategy: ReaderReconStrategyHint;
  signals: string[];
}

export interface ReaderReconSummary {
  totalLines: number;
  totalCharacters: number;
  averageLineLength?: number;
  structureHints?: string[];
  samples?: Array<ReaderRangeRef & { label: string }>;
  contentType?: ReaderReconContentType;
  suggestedStrategy?: ReaderReconStrategyHint;
  headingCount?: number;
  maxHeadingDepth?: number;
}

export interface ReaderReconBrief {
  source: ReaderSourceRef;
  title: string;
  stats: ReaderReconStats;
  structure: {
    headings: ReaderReconHeading[];
    headingCount: number;
    maxHeadingDepth: number;
    truncated: boolean;
    structureHints: string[];
  };
  samples: ReaderReconSample[];
  classification: ReaderReconClassification;
  summary: ReaderReconSummary;
  briefLines: string[];
}

export interface ReaderGoal {
  mode: ReaderMode;
  prompt: string;
  questions?: string[];
  targetEntities?: string[];
  stopWhenSatisfied?: boolean;
  requiredCoverage?: {
    minimumLineCoveragePercent?: number;
    requireEndToEndRead?: boolean;
  };
}

export interface ReaderCoverageRange extends ReaderRangeRef {
  id?: string;
  sessionId: string;
  noteId?: string | null;
  handoffId?: string | null;
  source: ReaderSourceRef;
  disposition: ReaderCoverageDisposition;
  reason: ReaderCoverageReason;
  toolName?: string;
  recordedAt?: string;
}

export interface ReaderEvidenceMetadata {
  id?: string;
  source: ReaderSourceRef;
  range: ReaderRangeRef;
  kind: ReaderEvidenceKind;
  statementKind: ReaderStatementKind;
  coverageDisposition: ReaderCoverageDisposition;
  quote?: string;
  note?: string;
  confidence?: number;
  capturedViaTool?: string;
}

export interface ReaderCheckpoint {
  kind: ReaderCheckpointKind;
  readSummary: string;
  skippedSummary: string;
  remainingGapsSummary: string;
  readRanges: ReaderLineRange[];
  skippedRanges: ReaderLineRange[];
  remainingGapRanges: ReaderLineRange[];
}

export interface ReaderNote {
  id: string;
  sessionId: string;
  status: ReaderNoteStatus;
  ordinal: number;
  summary: string;
  facts: string[];
  inferences: string[];
  unresolvedQuestions: string[];
  followUpActions: string[];
  evidence: ReaderEvidenceMetadata[];
  checkpoint?: ReaderCheckpoint;
  coverage: ReaderCoverageRange[];
  createdAt: string;
  updatedAt: string;
}

export interface ReaderCoverageSummary {
  totalLines: number;
  readLines: number;
  sampledLines: number;
  skippedLines: number;
  unvisitedLines: number;
  readPercent: number;
  visitedPercent: number;
  gapRanges: ReaderLineRange[];
  isUnvisitedDerived: true;
}

export interface ReaderConclusion {
  id?: string;
  title: string;
  summary: string;
  statementKind: ReaderStatementKind;
  confidence?: number;
  evidenceIds: string[];
}

export interface ReaderHandoff {
  id: string;
  sessionId: string;
  status: ReaderHandoffStatus;
  executiveSummary: string;
  conclusions: ReaderConclusion[];
  gaps: string[];
  caveats: string[];
  limitations: string[];
  nextQuestions: string[];
  evidence: ReaderEvidenceMetadata[];
  coverageSummary: ReaderCoverageSummary;
  createdAt: string;
}

export interface ReaderMasterHandoff {
  id: string;
  bookId: string;
  status: ReaderHandoffStatus;
  executiveSummary: string;
  conclusions: ReaderConclusion[];
  gaps: string[];
  caveats: string[];
  limitations: string[];
  nextQuestions: string[];
  sessionIds: string[];
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderSession {
  id: string;
  source: ReaderSourceRef;
  goal: ReaderGoal;
  status: ReaderSessionStatus;
  cursor?: ReaderLineRange;
  reconSummary?: ReaderReconSummary;
  coverageSummary?: ReaderCoverageSummary;
  lastNoteId?: string | null;
  handoffId?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}