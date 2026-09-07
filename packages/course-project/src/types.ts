export type LatLng = { lat: number; lng: number };
export type CourseIndex = {
  points: LatLng[];
  cum: number[]; // meters, same length as points
  totalM: number;
};
export type ProjectResult = {
  s: number; // along-track m
  proj: LatLng;
  dist: number; // off-track m
  offCourse: boolean;
  lap: number;
};
