import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultImageKind,
  type DefaultImageKind,
} from "../lib/defaultImage";

test("default image classifier covers all eleven silhouettes", () => {
  const cases: Array<[string, DefaultImageKind]> = [
    ["hardshell-jackets", "jacket"],
    ["fleece-midlayer", "fleece"],
    ["pants", "pants"],
    ["snow-bibs", "overall"],
    ["shirts", "shirt"],
    ["swimwear", "swim"],
    ["beanies", "beanie"],
    ["footwear", "shoes"],
    ["backpacks", "bag"],
    ["snowboards", "snowboard"],
    ["equipment", "other"],
  ];

  for (const [category, expected] of cases)
    assert.equal(defaultImageKind(category), expected, category);
});

test("specific categories win over generic top and bottom labels", () => {
  assert.equal(defaultImageKind("hardshell-jackets tops"), "jacket");
  assert.equal(defaultImageKind("bikini-tops"), "swim");
  assert.equal(defaultImageKind("bikini-bottoms"), "swim");
  assert.equal(defaultImageKind("short-sleeve"), "shirt");
  assert.equal(defaultImageKind("shorts"), "pants");
});

test("concrete product types win over snowboard and swim activity labels", () => {
  assert.equal(defaultImageKind("snowboard-boots"), "shoes");
  assert.equal(defaultImageKind("snowboard-pants"), "pants");
  assert.equal(defaultImageKind("hardshell-pants"), "pants");
  assert.equal(defaultImageKind("swim sandals"), "shoes");
  assert.equal(defaultImageKind("snowboard-jackets"), "jacket");
  assert.equal(defaultImageKind("snowboards"), "snowboard");
  assert.equal(defaultImageKind("splitboards"), "snowboard");
});
