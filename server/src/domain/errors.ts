export type DomainErrorCode =
  | "ambiguous_unit"
  | "unknown_unit"
  | "unknown_purity"
  | "invalid_purity"
  | "invalid_weight"
  | "invalid_non_metal_weight";

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  fix: string;
}
