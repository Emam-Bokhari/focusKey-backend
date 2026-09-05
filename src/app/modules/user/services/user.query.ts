import { JwtPayload } from "jsonwebtoken";
import { User } from "../user.model";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../errors/ApiErrors";
import { USER_ROLES } from "../../../../enums/user";
import QueryBuilder from "../../../builder/queryBuilder";
import { IUser } from "../user.interface";
import { ModeService } from "../../modes/modes.service";

const getUserProfileFromDB = async (user: JwtPayload): Promise<any> => {
  const { id } = user;

  const result = await User.findById(id).lean();
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  await ModeService.ensureDefaultModesExist(result._id.toString());

  return result;
};

const getAllUsersFromDB = async (query: any) => {
  const { role = USER_ROLES.USER, status, ...remainingQuery } = query;

  const filter: Record<string, any> = {
    role,
    verified: true,
  };

  if (status) {
    filter.status = status;
  }

  const baseQuery = User.find(filter);

  if (!remainingQuery.fields) {
    baseQuery.select("-installedApps");
  }

  const searchableFields = ["name", "email"];

  const queryBuilder = new QueryBuilder<IUser>(baseQuery, remainingQuery)
    .search(searchableFields)
    .sort()
    .fields()
    .filter()
    .paginate();

  const [users, meta] = await Promise.all([
    queryBuilder.modelQuery.lean(),
    queryBuilder.countTotal(),
  ]);

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
  }).lean();

  if (!result)
    throw new ApiError(404, "No user is found in the database by this ID");

  return result;
};

const getAdminFromDB = async (query: any) => {
  const baseQuery = User.find({
    role: { $in: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
    verified: true,
  }).select(
    "name email role profileImage createdAt updatedAt status lastLoginAt",
  );

  const queryBuilder = new QueryBuilder<IUser>(baseQuery, query)
    .search(["name", "email"])
    .sort()
    .fields()
    .paginate();

  const [admins, meta] = await Promise.all([
    queryBuilder.modelQuery.lean(),
    queryBuilder.countTotal(),
  ]);

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
