class APIFeatures {
  query: any;
  queryString: Record<string, any>;

  constructor(query: any, queryString: Record<string, any>) {
    this.query = query;
    this.queryString = queryString;
  }

  search(searchTarget: string[]) {
    const searchTerm: string | undefined = this.queryString.searchTerm;

    let query = {};
    if (searchTerm !== "undefined" && searchTerm !== undefined && searchTerm) {
      const regex = new RegExp(searchTerm, "i");
      query = {
        ...query,
        $or: searchTarget?.map((field) => ({
          [field]: {
            $regex: regex,
            $options: "i",
          },
        })),
      };
    }
    this.query = this.query.find(query);
    return this;
  }

  filter() {
    const queryCopy: Record<string, any> = { ...this.queryString };

    // Removing fields not related to filtering
    const removeFields: string[] = ["searchTerm", "page", "sort", "limit"];
    removeFields.forEach((el) => delete queryCopy[el]);

    let query: Record<string, any> = {};

    // Handle price range filtering
    if (queryCopy.minPrice || queryCopy.maxPrice) {
      query.price = {};
      if (queryCopy.minPrice) {
        query.price.$gte = Number(queryCopy.minPrice); // Greater than or equal to minPrice
      }
      if (queryCopy.maxPrice) {
        query.price.$lte = Number(queryCopy.maxPrice); // Less than or equal to maxPrice
      }
    }

    // Handle rating filter (greater than or equal to a rating value)
    if (queryCopy.rating) {
      query.rating = { $gte: Number(queryCopy.rating) };
    }

    // Other filters can be added similarly, e.g., category, brand, etc.
    Object.keys(queryCopy).forEach((key) => {
      if (
        !removeFields.includes(key) &&
        !["minPrice", "maxPrice", "rating"].includes(key)
      ) {
        query[key] = queryCopy[key];
      }
    });

    this.query = this.query.find(query);
    return this;
  }

  async pagination() {
    // Get page and limit from query string
    const page = Number(this.queryString.page) || 1; // Default to page 1
    const limit = Number(this.queryString.limit) || 10; // Default to limit of 10

    // Calculate total documents and skip count
    const total = await this.query.countDocuments();
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    // Apply pagination
    this.query = this.query.skip(skip).limit(limit);

    // Return pagination info
    return {
      total,
      totalPages,
      currentPage: page,
      limit,
    };
  }
}

export default APIFeatures;
