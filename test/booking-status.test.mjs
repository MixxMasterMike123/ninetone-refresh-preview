import assert from "node:assert/strict";
import test from "node:test";

import { isActiveBookingArtist } from "../src/lib/booking-status.ts";

test("only the exact FileMaker Active value makes a booking talent public", () => {
  assert.equal(isActiveBookingArtist({ filterActive: "Active" }), true);
  assert.equal(isActiveBookingArtist({ "Green HeadArtist::filterActive": "Active" }), true);

  for (const status of ["Not Active", "", "Active ", "active", undefined]) {
    assert.equal(isActiveBookingArtist({ filterActive: status }), false, `status ${String(status)}`);
    assert.equal(
      isActiveBookingArtist({ "Green HeadArtist::filterActive": status }),
      false,
      `portal status ${String(status)}`,
    );
  }

  assert.equal(
    isActiveBookingArtist({ filterActive: "Not Active", "Green HeadArtist::filterActive": "Active" }),
    false,
    "conflicting status fields fail closed",
  );
});
