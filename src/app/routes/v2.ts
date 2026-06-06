import express from "express";
import { UserRoutes } from "../modules/user/user.routes";

const v2Router = express.Router();

const apiRoutes = [
  {
    path: "/users",
    route: UserRoutes,
  },
];

apiRoutes.forEach((route) => v2Router.use(route.path, route.route));

export default v2Router;
