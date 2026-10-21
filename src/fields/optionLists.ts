import { SelectOption } from "./types";

// Named option lists a `select` field can point at instead of repeating them inline. Served in
// GET /forms `optionLists`, so the app has them offline.

// GST state codes (value) and their names (label). Codes 25 (old Daman and Diu) and 28 (undivided
// Andhra Pradesh) are retired, so they're left out; 96 and 97 cover supplies outside the states.
const INDIAN_STATES: SelectOption[] = [
  { value: "01", label: "Jammu and Kashmir" },
  { value: "02", label: "Himachal Pradesh" },
  { value: "03", label: "Punjab" },
  { value: "04", label: "Chandigarh" },
  { value: "05", label: "Uttarakhand" },
  { value: "06", label: "Haryana" },
  { value: "07", label: "Delhi" },
  { value: "08", label: "Rajasthan" },
  { value: "09", label: "Uttar Pradesh" },
  { value: "10", label: "Bihar" },
  { value: "11", label: "Sikkim" },
  { value: "12", label: "Arunachal Pradesh" },
  { value: "13", label: "Nagaland" },
  { value: "14", label: "Manipur" },
  { value: "15", label: "Mizoram" },
  { value: "16", label: "Tripura" },
  { value: "17", label: "Meghalaya" },
  { value: "18", label: "Assam" },
  { value: "19", label: "West Bengal" },
  { value: "20", label: "Jharkhand" },
  { value: "21", label: "Odisha" },
  { value: "22", label: "Chhattisgarh" },
  { value: "23", label: "Madhya Pradesh" },
  { value: "24", label: "Gujarat" },
  { value: "26", label: "Dadra and Nagar Haveli and Daman and Diu" },
  { value: "27", label: "Maharashtra" },
  { value: "29", label: "Karnataka" },
  { value: "30", label: "Goa" },
  { value: "31", label: "Lakshadweep" },
  { value: "32", label: "Kerala" },
  { value: "33", label: "Tamil Nadu" },
  { value: "34", label: "Puducherry" },
  { value: "35", label: "Andaman and Nicobar Islands" },
  { value: "36", label: "Telangana" },
  { value: "37", label: "Andhra Pradesh" },
  { value: "38", label: "Ladakh" },
  { value: "96", label: "Outside India" },
  { value: "97", label: "Other Territory" },
];

export const OPTION_LISTS: Readonly<Record<string, SelectOption[]>> = {
  indian_states: INDIAN_STATES,
};

export const optionList = (name: string): SelectOption[] | undefined =>
  Object.prototype.hasOwnProperty.call(OPTION_LISTS, name) ? OPTION_LISTS[name] : undefined;
