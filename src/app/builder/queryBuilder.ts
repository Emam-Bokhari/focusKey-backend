import { FilterQuery, Query, Types } from "mongoose";


class QueryBuilder<T> {
  public modelQuery: Query<T[], T>;
  public query: Record<string, unknown>;

  constructor(modelQuery: Query<T[], T>, query: Record<string, unknown>) {
    this.modelQuery = modelQuery;
    this.query = query;
  }

  // SEARCH (generic + safe)
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

    // ObjectId support
    if (Types.ObjectId.isValid(searchTerm)) {
      orConditions.push({
        _id: new Types.ObjectId(searchTerm),
      });
    }

    // 🔥 IMPORTANT: guard empty OR
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

    // remove empty values
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

    /* ================= ENUM FILTERS ================= */

    // STATUS
    if (queryObj.status) {
      finalFilter.status = queryObj.status;
    }

    // isFeatured (COMMENTED FOR FUTURE USE)
    /*
    if (queryObj.isFeatured !== undefined) {
      finalFilter.isFeatured =
        queryObj.isFeatured === "true" || queryObj.isFeatured === true;
    }
    */

    /* ================= TEXT FILTER ================= */

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

  //  SORT
  sort() {
    const sort =
      (this.query.sort as string)?.split(",").join(" ") || "-createdAt";

    this.modelQuery = this.modelQuery.sort(sort);

    return this;
  }

  //  PAGINATION
  paginate() {
    const page = Number(this.query.page) || 1;
    const limit = Number(this.query.limit) || 10;

    const skip = (page - 1) * limit;

    this.modelQuery = this.modelQuery.skip(skip).limit(limit);

    return this;
  }

  //  FIELD SELECTION
  fields() {
    const fields =
      (this.query.fields as string)?.split(",").join(" ") || "-__v";

    this.modelQuery = this.modelQuery.select(fields);

    return this;
  }

  // COUNT META
  async countTotal() {
    const filter = this.modelQuery.getFilter();

    // Fix: countDocuments does not support $near/$nearSphere
    // We convert these to $geoWithin for counting purposes to keep the radius filter
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

              // Replace $near with $geoWithin
              delete val.$near;
              delete val.$nearSphere;
              val.$geoWithin = {
                $centerSphere: [coordinates, radiusInRadians],
              };
            } else {
              // If we can't convert it accurately, just remove it to avoid crash
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
