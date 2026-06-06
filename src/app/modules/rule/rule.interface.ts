export enum RULE_TYPE {
  PRIVACY = "PRIVACY",
  TERMS = "TERMS",
  ABOUT = "ABOUT",
}

export type TRule = {
  content: string;
  type: RULE_TYPE;
};
