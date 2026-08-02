import { Schema, Query, Aggregate, Document, Model } from "mongoose";

export interface ISoftDeleteMethods {
  softDelete(): Promise<Document>;
  restore(): Promise<Document>;
}

export interface ISoftDeleteStatics<T> extends Model<T> {
  softDeleteById(id: string): Promise<T | null>;
  restoreById(id: string): Promise<T | null>;
  softDeleteMany(filter: Record<string, any>): Promise<any>;
  restoreMany(filter: Record<string, any>): Promise<any>;
}

export function softDeletePlugin<T>(schema: Schema<T>) {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, index: true },
  } as any);

  const excludeDeletedFilter = function (this: Query<any, any>) {
    const filters = this.getFilter();
    if ((filters as Record<string, any>).isDeleted === undefined) {
      this.where({ isDeleted: { $ne: true } });
    }
  };

  const queryMethods = [
    "find",
    "findOne",
    "findOneAndDelete",
    "findOneAndReplace",
    "findOneAndUpdate",
    "countDocuments",
    "distinct",
  ];
  queryMethods.forEach((method) => {
    schema.pre(method as any, excludeDeletedFilter);
  });

  schema.pre(/update/i, function (this: Query<any, any>) {
    const filters = this.getFilter();
    if ((filters as Record<string, any>).isDeleted === undefined) {
      this.where({ isDeleted: { $ne: true } });
    }
  });

  schema.pre("aggregate", function (this: Aggregate<any>) {
    const pipeline = this.pipeline();
    const firstStage = pipeline[0];

    if (!firstStage || !("$geoNear" in firstStage)) {
      pipeline.unshift({ $match: { isDeleted: { $ne: true } } });
    }
  });

  schema.methods.softDelete = function () {
    (this as any).isDeleted = true;
    (this as any).deletedAt = new Date();
    return this.save();
  };

  schema.methods.restore = function () {
    (this as any).isDeleted = false;
    (this as any).deletedAt = null;
    return this.save();
  };

  schema.statics.softDeleteById = function (id: string) {
    return this.findOneAndUpdate(
      { _id: id } as any,
      { $set: { isDeleted: true, deletedAt: new Date() } } as any,
      { new: true },
    );
  };

  schema.statics.restoreById = function (id: string) {
    return (this as Model<T>).findOneAndUpdate(
      { _id: id, isDeleted: true } as any,
      { $set: { isDeleted: false, deletedAt: null } } as any,
      { new: true },
    );
  };

  schema.statics.softDeleteMany = function (filter: Record<string, any>) {
    return this.updateMany(
      filter as any,
      {
        $set: { isDeleted: true, deletedAt: new Date() },
      } as any,
    );
  };

  schema.statics.restoreMany = function (filter: Record<string, any>) {
    return this.updateMany(
      { ...filter, isDeleted: true } as any,
      { $set: { isDeleted: false, deletedAt: null } } as any,
    );
  };
}
