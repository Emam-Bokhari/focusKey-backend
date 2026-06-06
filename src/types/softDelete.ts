import { Model } from "mongoose";

export interface ISoftDeleteModel<T> extends Model<T> {
  softDeleteById(id: string): Promise<T | null>;
  restoreById(id: string): Promise<T | null>;
  softDeleteMany(filter: any): Promise<any>;
  restoreMany(filter: any): Promise<any>;
}
