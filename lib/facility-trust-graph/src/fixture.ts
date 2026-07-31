// The public-safe fixture hospital graph — one floor of "Fixture Health",
// including the multi-bed Room 312 that motivates the certainty ladder. Used by
// the MCP server (and any demo surface) so a chat can exercise the Facility
// Trust Graph against a real, validated model. Entirely synthetic: no real
// facility, vendor tenancy, or floor plan is described.

import { buildFacilityGraph, type FacilityGraph, type FacilityGraphDoc } from "./graph";

export const FIXTURE_HOSPITAL_GRAPH_DOC: FacilityGraphDoc = {
  mapVersion: "2026.07.14",
  spaces: [
    { spaceId: "SG-ORG", kind: "organization", name: "Fixture Health", parentId: null },
    { spaceId: "SG-HOSP-A", kind: "campus", name: "Hospital A", parentId: "SG-ORG" },
    { spaceId: "SG-HOSP-A-BLDG1", kind: "building", name: "Building 1", parentId: "SG-HOSP-A" },
    { spaceId: "SG-HOSP-A-BLDG1-F03", kind: "floor", name: "Floor 3", parentId: "SG-HOSP-A-BLDG1",
      vendorRefs: { cisco: { floor_id: "flr-9911", map_id: "map-77" } } },
    { spaceId: "SG-F03-ZONE-MED", kind: "security_zone", name: "Medication zone", parentId: "SG-HOSP-A-BLDG1-F03",
      securityClassification: "controlled" },
    { spaceId: "SG-F03-UNIT-4W", kind: "unit", name: "4 West Med-Surg", parentId: "SG-HOSP-A-BLDG1-F03",
      vendorRefs: { ehr: { nursing_unit: "4W" } } },
    { spaceId: "SG-RM0312", kind: "room", name: "Room 312", parentId: "SG-F03-UNIT-4W",
      vendorRefs: { cisco: { zone_id: "zn-312" }, ehr: { room: "0312" } } },
    { spaceId: "SG-RM0312-BED-A", kind: "bed", name: "Bed A", parentId: "SG-RM0312",
      vendorRefs: { rtls: { bed_zone_id: "bz-312a" }, ehr: { bed: "0312-A" } } },
    { spaceId: "SG-RM0312-BED-B", kind: "bed", name: "Bed B", parentId: "SG-RM0312",
      vendorRefs: { rtls: { bed_zone_id: "bz-312b" }, ehr: { bed: "0312-B" } } },
    { spaceId: "SG-RM0312-DOOR", kind: "door", name: "Room 312 door", parentId: "SG-RM0312",
      vendorRefs: { physical_access: { door_id: "door-3120", reader_id: "rdr-3120" } } },
  ],
};

/** Built (and therefore validated) on first import — a fixture that fails the
 *  graph's own refusals cannot load. */
export const FIXTURE_HOSPITAL_GRAPH: FacilityGraph = buildFacilityGraph(FIXTURE_HOSPITAL_GRAPH_DOC);
