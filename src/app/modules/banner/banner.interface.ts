import { ISoftDeleteModel } from "../../../types/softDelete";

export type TBanner = {
  name: string;
  description: string;
  image: string;
  status: boolean;
};
export type TBannerModel = ISoftDeleteModel<TBanner>;
