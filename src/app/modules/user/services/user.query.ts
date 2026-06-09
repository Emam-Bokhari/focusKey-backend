import { JwtPayload } from "jsonwebtoken";
import { User } from "../user.model";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../errors/ApiErrors";
import { USER_ROLES } from "../../../../enums/user";
import QueryBuilder from "../../../builder/queryBuilder";
import { IUser } from "../user.interface";

const getUserProfileFromDB = async (user: JwtPayload): Promise<any> => {
  const { id } = user;

  const result: any = await User.findById(id);
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  return result;
};

const getAllUsersFromDB = async (query: any) => {
  const { role = USER_ROLES.USER, status, ...remainingQuery } = query;

  // Base user filter
  const filter: Record<string, any> = {
    role,
    verified: true,
  };

  // Add status filter if provided
  if (status) {
    filter.status = status;
  }

  const baseQuery = User.find(filter);

  const searchableFields =
    role === USER_ROLES.AGENT
      ? ["name", "email", "location.address"]
      : ["name", "email"];

  const queryBuilder = new QueryBuilder<IUser>(baseQuery, remainingQuery)
    .search(searchableFields)
    .sort()
    .fields()
    .filter()
    .paginate();

  // Fetch paginated users
  let users: any[] = await queryBuilder.modelQuery.lean();
  const meta = await queryBuilder.countTotal();

  if (!users || users.length === 0) {
    throw new ApiError(404, "No users are found in the database");
  }

  return {
    data: users,
    meta,
  };
};

const getUserByIdFromDB = async (id: string) => {
  const result = await User.findOne({
    _id: id,
    role: USER_ROLES.USER,
  });

  if (!result)
    throw new ApiError(404, "No user is found in the database by this ID");

  return result;
};

const getAdminFromDB = async (query: any) => {
  const baseQuery = User.find({
    role: { $in: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
    // status: STATUS.ACTIVE,
    verified: true,
  }).select(
    "name email role profileImage createdAt updatedAt status lastLoginAt",
  );

  const queryBuilder = new QueryBuilder<IUser>(baseQuery, query)
    .search(["name", "email"])
    .sort()
    .fields()
    .paginate();

  const admins = await queryBuilder.modelQuery;

  const meta = await queryBuilder.countTotal();

  return {
    data: admins,
    meta,
  };
};

export const UserQueries = {
  getUserProfileFromDB,
  getAllUsersFromDB,
  getUserByIdFromDB,
  getAdminFromDB,
};
