// document.ingest
export type DocumentIngestInput = {
  file_path: string;
  extract_structure?: boolean;  // extract headings, sections
  extract_tables?: boolean;
  max_pages?: number;
};
export type DocumentSection = {
  heading?: string;
  level?: number;
  content: string;
  page?: number;
};
export type DocumentTable = {
  caption?: string;
  headers: string[];
  rows: string[][];
  page?: number;
};
export type DocumentIngestOutput = {
  file_path: string;
  file_type: "pdf" | "docx" | "txt" | "md" | "unknown";
  page_count?: number;
  word_count: number;
  text: string;
  sections: DocumentSection[];
  tables: DocumentTable[];
  metadata: Record<string, unknown>;
  ingested_at: string;
};

// document.extract_clauses
export type ClauseCategory =
  | "jurisdiction" | "term" | "confidentiality" | "ip_assignment"
  | "indemnity" | "liability_cap" | "non_compete" | "termination"
  | "payment" | "warranty" | "general";
export type ExtractedClause = {
  clause_id: string;
  category: ClauseCategory;
  title: string;
  text: string;
  page?: number;
  risk_level: "low" | "medium" | "high" | "critical";
  flags: string[];   // specific concerns: "unlimited_liability", "broad_ip_assignment"
};
export type DocumentExtractClausesInput = {
  file_path?: string;
  text?: string;     // or pass raw text directly
  document_type?: "nda" | "msa" | "sow" | "contract" | "agreement";
};
export type DocumentExtractClausesOutput = {
  document_type: string;
  clauses: ExtractedClause[];
  total_clauses: number;
  high_risk_count: number;
  critical_count: number;
  extracted_at: string;
};

// document.analyze_compliance
export type ComplianceFramework = "iso_26262" | "aspice" | "iec_61508" | "iso_21434";
export type ComplianceItem = {
  requirement_id: string;
  requirement: string;
  framework: ComplianceFramework;
  asil_level?: "A" | "B" | "C" | "D";
  status: "present" | "missing" | "partial" | "not_applicable";
  evidence?: string;
  gap_description?: string;
};
export type DocumentAnalyzeComplianceInput = {
  file_path?: string;
  text?: string;
  framework: ComplianceFramework;
  project_asil?: "A" | "B" | "C" | "D";
  work_product_type?: string;  // "software_plan", "dv_report", "tsr", "dia"
};
export type DocumentAnalyzeComplianceOutput = {
  framework: ComplianceFramework;
  project_asil?: string;
  total_requirements: number;
  present_count: number;
  missing_count: number;
  partial_count: number;
  compliance_score: number;   // 0-100
  items: ComplianceItem[];
  critical_gaps: string[];
  analyzed_at: string;
};

// document.compare
export type DocumentCompareInput = {
  file_path_a: string;
  file_path_b: string;
  compare_mode?: "full" | "sections" | "clauses";
};
export type DocumentChange = {
  change_type: "added" | "removed" | "modified";
  section?: string;
  description: string;
  significance: "minor" | "moderate" | "major";
};
export type DocumentCompareOutput = {
  file_a: string;
  file_b: string;
  total_changes: number;
  major_changes: number;
  changes: DocumentChange[];
  similarity_score: number;   // 0-1
  compared_at: string;
};

// document.generate_report
export type ReportTemplate = "proposal" | "evidence_gap" | "compliance_summary" | "nda_analysis" | "custom";
export type DocumentGenerateReportInput = {
  template: ReportTemplate;
  data: Record<string, unknown>;
  output_format: "docx" | "pdf" | "markdown";
  output_path: string;
  title?: string;
};
export type DocumentGenerateReportOutput = {
  output_path: string;
  output_format: string;
  template: string;
  title: string;
  section_count: number;
  generated_at: string;
};
