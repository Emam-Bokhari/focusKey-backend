import { StatusCodes } from "http-status-codes";
import { Faq } from "./faq.model";
import mongoose from "mongoose";
import ApiError from "../../../errors/ApiErrors";
import { TFaq } from "./faq.interface";

const createFaqToDB = async (payload: TFaq) => {
  const faq = await Faq.create(payload);
  if (!faq) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to created Faq");
  }

  return faq;
};

const faqsFromDB = async () => {
  const faqs = await Faq.find({});
  if (!faqs || faqs.length === 0) {
    return [];
  }
  return faqs;
};

const updateFaqToDB = async (id: string, payload: TFaq) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid ID");
  }

  const updatedFaq = await Faq.findByIdAndUpdate({ _id: id }, payload, {
    new: true,
  });
  if (!updatedFaq) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to updated Faq");
  }

  return updatedFaq;
};


const deleteFaqToDB = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid ID");
  }

  const result = await Faq.softDeleteById(id);

  if (!result) {
    return {};
  }

  return result;
};

export const FaqService = {
  createFaqToDB,
  updateFaqToDB,
  faqsFromDB,
  deleteFaqToDB,
};
