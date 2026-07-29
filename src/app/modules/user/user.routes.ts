import express from "express";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import { UserControllers } from "./user.controller";
import { isAdmin, isAuthenticated, isUser } from "../../../helpers/authHelper";
import { parseFileData } from "../../middlewares/parseFileData";
import validateRequest from "../../middlewares/validateRequest";
import { UserValidation } from "./user.validation";

const router = express.Router();

router.post(
  "/pair-device",
  isUser,
  validateRequest(UserValidation.handleUserPairingZodSchema),
  UserControllers.handleUserPairing,
);

router
  .route("/profile")
  .get(isAuthenticated, UserControllers.getUserProfile)
  .delete(isAuthenticated, UserControllers.deleteProfile);

router.post("/create-admin", isAdmin, UserControllers.createAdmin);

router.get("/admins", isAdmin, UserControllers.getAdmin);

router
  .route("/")
  .post(
    validateRequest(UserValidation.createUserZodSchema),
    UserControllers.createUser,
  )
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
