import express from "express";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import { UserControllers } from "./user.controller";
import { isAdmin, isAuthenticated } from "../../../helpers/authHelper";
import { parseFileData } from "../../middlewares/parseFileData";

const router = express.Router();

router
  .route("/profile")
  .get(isAuthenticated, UserControllers.getUserProfile)
  .delete(isAuthenticated, UserControllers.deleteProfile);

router.post("/create-admin", isAdmin, UserControllers.createAdmin);

router.get("/admins", isAdmin, UserControllers.getAdmin);

router
  .route("/")
  .post(UserControllers.createUser)
  .get(isAdmin, UserControllers.getAllUsers)
  .patch(
    isAuthenticated,
    fileUploadHandler(),
    parseFileData(
      {
        fieldName: "profileImage",
        mode: "single",
      },
      {
        fieldName: "agencyLogo",
        mode: "single",
      },
    ),

    UserControllers.updateProfile,
  );

router.patch("/status/:id", isAdmin, UserControllers.updateUserStatusById);

router.delete("/admins/:id", isAdmin, UserControllers.deleteAdmin);

/* ---------------------------- ADMINS LIST ------------------------------- */

router
  .route("/:id")
  .get(isAdmin, UserControllers.getUserById)
  .delete(isAdmin, UserControllers.deleteUserById);

export const UserRoutes = router;
