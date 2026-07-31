import mongoose from "mongoose";
import config from "./config";
import { User } from "./app/modules/user/user.model";
import { RegisteredDevice } from "./app/modules/registeredDevice/registeredDevice.model";
import { RegisteredDeviceService } from "./app/modules/registeredDevice/registeredDevice.service";
import { UserCommands } from "./app/modules/user/services/user.command";

async function runTest() {
  console.log("Connecting to database:", config.database_url);
  await mongoose.connect(config.database_url as string);
  console.log("Database connected.");

  // Cleanup potential previous tests
  await User.deleteMany({ email: "test-pairing-user@example.com" });
  await RegisteredDevice.deleteMany({ uid: "04A1B2C3D4E5F6" });

  console.log("\n--- Testing Device Registration ---");
  const device = await RegisteredDeviceService.createDeviceToDB({
    uid: "04A1B2C3D4E5F6",
    status: "ACTIVE",
    notes: "Test tag registration",
  });
  console.log("Device registered:", {
    uid: device.uid,
    serialNo: device.serialNo,
    status: device.status,
    deviceFingerprint: device.deviceFingerprint,
    userId: device.userId,
  });

  console.log("\n--- Testing User Creation ---");
  const user = await User.create({
    name: "Test Pairing User",
    email: "test-pairing-user@example.com",
    password: "password123",
    verified: true,
  });
  console.log("User created:", {
    id: user._id,
    name: user.name,
    email: user.email,
    isPaired: user.isPaired,
  });

  const userId = user._id.toString();

  console.log("\n--- Testing Fingerprint Security Validation ---");
  try {
    await UserCommands.handleUserPairing(userId, {
      uid: "04A1B2C3D4E5F6",
      deviceFingerprint: "unknown",
      device_model: "Pixel 8",
      platform: "android",
    });
    console.error("FAIL: Allowed pairing with placeholder 'unknown' fingerprint.");
  } catch (err: any) {
    console.log("SUCCESS: Blocked 'unknown' fingerprint correctly:", err.message);
  }

  console.log("\n--- Testing Successful Pairing (First Pairing) ---");
  const pairedUser = await UserCommands.handleUserPairing(userId, {
    uid: "04A1B2C3D4E5F6",
    deviceFingerprint: "fingerprint-xyz-123",
    device_model: "Pixel 8",
    platform: "android",
  });
  console.log("User after pairing:", {
    isPaired: pairedUser.isPaired,
    device: pairedUser.device,
  });

  const updatedDevice = await RegisteredDevice.findOne({ uid: "04A1B2C3D4E5F6" });
  console.log("Device after pairing:", {
    uid: updatedDevice?.uid,
    deviceFingerprint: updatedDevice?.deviceFingerprint,
    deviceModel: updatedDevice?.deviceModel,
    platform: updatedDevice?.platform,
    userId: updatedDevice?.userId,
    firstPairedAt: updatedDevice?.firstPairedAt,
    lastPairedAt: updatedDevice?.lastPairedAt,
    pairedAt: updatedDevice?.pairedAt,
  });

  console.log("\n--- Testing Mismatch Fingerprint Re-pairing ---");
  // Create another user
  const user2 = await User.create({
    name: "Test User 2",
    email: "test-user-2@example.com",
    password: "password123",
  });
  try {
    await UserCommands.handleUserPairing(user2._id.toString(), {
      uid: "04A1B2C3D4E5F6",
      deviceFingerprint: "fingerprint-different-789",
      device_model: "Pixel 8",
      platform: "android",
    });
    console.error("FAIL: Allowed pairing with mismatched fingerprint.");
  } catch (err: any) {
    console.log("SUCCESS: Mismatched fingerprint rejected correctly:", err.message);
  }

  console.log("\n--- Testing Mismatch User Re-pairing ---");
  try {
    await UserCommands.handleUserPairing(user2._id.toString(), {
      uid: "04A1B2C3D4E5F6",
      deviceFingerprint: "fingerprint-xyz-123",
      device_model: "Pixel 8",
      platform: "android",
    });
    console.error("FAIL: Allowed pairing tag currently paired to another user.");
  } catch (err: any) {
    console.log("SUCCESS: Already paired to another user rejected correctly:", err.message);
  }

  // Cleanup user2
  await User.findByIdAndDelete(user2._id);

  console.log("\n--- Testing Double Pairing Protection ---");
  try {
    await UserCommands.handleUserPairing(userId, {
      uid: "04A1B2C3D4E5F6",
      deviceFingerprint: "fingerprint-xyz-123",
      device_model: "Pixel 8",
      platform: "android",
    });
    console.error("FAIL: Allowed pairing of user who is already paired.");
  } catch (err: any) {
    console.log("SUCCESS: Double pairing prevented correctly:", err.message);
  }

  console.log("\n--- Testing Unpairing ---");
  const unpairedUser = await UserCommands.handleUserUnpairing(userId);
  console.log("User after unpairing:", {
    isPaired: unpairedUser.isPaired,
    device: unpairedUser.device,
  });

  const deviceAfterUnpair = await RegisteredDevice.findOne({ uid: "04A1B2C3D4E5F6" });
  console.log("Device after unpairing:", {
    uid: deviceAfterUnpair?.uid,
    userId: deviceAfterUnpair?.userId,
    pairedAt: deviceAfterUnpair?.pairedAt,
    deviceFingerprint: deviceAfterUnpair?.deviceFingerprint, // should remain!
    platform: deviceAfterUnpair?.platform, // should remain!
    lastUnpairedAt: deviceAfterUnpair?.lastUnpairedAt, // should be set!
  });

  console.log("\n--- Testing Admin Reset ---");
  const deviceIdStr = deviceAfterUnpair?._id.toString() as string;
  const resetDeviceObj = await RegisteredDeviceService.resetDeviceToDB(deviceIdStr);
  console.log("Device after admin reset:", {
    uid: resetDeviceObj?.uid,
    deviceFingerprint: resetDeviceObj?.deviceFingerprint, // should be null!
    platform: resetDeviceObj?.platform, // should be null!
    userId: resetDeviceObj?.userId, // should be null!
  });

  // Cleanup test documents
  await User.deleteMany({ email: "test-pairing-user@example.com" });
  await RegisteredDevice.deleteMany({ uid: "04A1B2C3D4E5F6" });

  await mongoose.disconnect();
  console.log("\nDatabase disconnected. Test completed successfully.");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  mongoose.disconnect();
});
