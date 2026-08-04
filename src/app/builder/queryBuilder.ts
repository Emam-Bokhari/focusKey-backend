import { FilterQuery, Query, Types } from "mongoose";

class QueryBuilder<T> {
  public modelQuery: Query<T[], T>;
  public query: Record<string, unknown>;

  constructor(modelQuery: Query<T[], T>, query: Record<string, unknown>) {
    this.modelQuery = modelQuery;
    this.query = query;
  }

  search(searchableFields: string[]) {
    const searchTerm = this.query.searchTerm as string;

    if (!searchTerm) return this;

    const orConditions: FilterQuery<any>[] = [];

    searchableFields.forEach((field) => {
      orConditions.push({
        [field]: {
          $regex: searchTerm,
          $options: "i",
        },
      });
    });

    if (Types.ObjectId.isValid(searchTerm)) {
      orConditions.push({
        _id: new Types.ObjectId(searchTerm),
      });
    }

    if (orConditions.length === 0) return this;

    this.modelQuery = this.modelQuery.find({
      $or: orConditions,
    });

    return this;
  }

  filter() {
    const queryObj = { ...this.query };

    const excludeFields = ["searchTerm", "sort", "limit", "page", "fields"];

    excludeFields.forEach((el) => delete queryObj[el]);

    Object.keys(queryObj).forEach((key) => {
      if (
        queryObj[key] === undefined ||
        queryObj[key] === null ||
        queryObj[key] === ""
      ) {
        delete queryObj[key];
      }
    });

    const finalFilter: any = {};


    if (queryObj.status) {
      finalFilter.status = queryObj.status;
    }


    if (queryObj.city) {
      finalFilter.city = {
        $regex: queryObj.city,
        $options: "i",
      };
    }

    if (Object.keys(finalFilter).length > 0) {
      this.modelQuery = this.modelQuery.find(finalFilter);
    }

    return this;
  }

  sort() {
    const sort =
      (this.query.sort as string)?.split(",").join(" ") || "-createdAt";

    this.modelQuery = this.modelQuery.sort(sort);

    return this;
  }

  paginate() {
    const page = Number(this.query.page) || 1;
    const limit = Number(this.query.limit) || 10;

    const skip = (page - 1) * limit;

    this.modelQuery = this.modelQuery.skip(skip).limit(limit);

    return this;
  }

  fields(customFields?: string) {
    const fields =
      customFields ||
      (this.query.fields as string)?.split(",").join(" ") ||
      "-__v";

    this.modelQuery = this.modelQuery.select(fields);

    return this;
  }

  async countTotal() {
    const filter = this.modelQuery.getFilter();

    const recursiveFixGeo = (obj: any) => {
      if (!obj || typeof obj !== "object") return;

      Object.keys(obj).forEach((key) => {
        const val = obj[key];
        if (val && typeof val === "object") {
          if (val.$near || val.$nearSphere) {
            const near = val.$near || val.$nearSphere;
            if (near.$geometry && near.$maxDistance !== undefined) {
              const coordinates = near.$geometry.coordinates;
              const radiusInRadians = near.$maxDistance / 6378100;

              delete val.$near;
              delete val.$nearSphere;
              val.$geoWithin = {
                $centerSphere: [coordinates, radiusInRadians],
              };
            } else {
              delete val.$near;
              delete val.$nearSphere;
            }
          } else {
            recursiveFixGeo(val);
          }
        }
      });
    };

    const countFilter = JSON.parse(JSON.stringify(filter));
    recursiveFixGeo(countFilter);

    const total = await this.modelQuery.model.countDocuments(countFilter);

    const page = Number(this.query.page) || 1;
    const limit = Number(this.query.limit) || 10;

    return {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    };
  }
}

export default QueryBuilder;
