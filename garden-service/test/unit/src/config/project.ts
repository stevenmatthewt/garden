/*
 * Copyright (C) 2018-2020 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { platform } from "os"
import { expect } from "chai"
import tmp from "tmp-promise"
import {
  ProjectConfig,
  resolveProjectConfig,
  defaultEnvironments,
  pickEnvironment,
  defaultVarfilePath,
  defaultEnvVarfilePath,
  parseEnvironment,
} from "../../../../src/config/project"
import { DEFAULT_API_VERSION } from "../../../../src/constants"
import { expectError } from "../../../helpers"
import { defaultDotIgnoreFiles } from "../../../../src/util/fs"
import { realpath, writeFile } from "fs-extra"
import { dedent } from "../../../../src/util/string"
import { resolve } from "path"

describe("resolveProjectConfig", () => {
  it("should pass through a canonical project config", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      outputs: [],
      providers: [{ name: "some-provider" }],
      variables: {},
    }

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      environments: [
        {
          name: "default",
          namespacing: "optional",
          production: false,
          providers: [],
          variables: {},
        },
      ],
      sources: [],
      varfile: defaultVarfilePath,
    })
  })

  it("should inject a default environment if none is specified", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "local",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [],
      outputs: [],
      providers: [{ name: "some-provider" }],
      variables: {},
    }

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      sources: [],
      environments: defaultEnvironments,
      varfile: defaultVarfilePath,
    })
  })

  it("should resolve template strings on fields other than provider configs", async () => {
    const repositoryUrl = "git://github.com/foo/bar.git#boo"

    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {
            envVar: "${local.env.TEST_ENV_VAR}",
          },
        },
      ],
      providers: [{ name: "some-provider" }],
      sources: [
        {
          name: "${local.env.TEST_ENV_VAR}",
          repositoryUrl,
        },
      ],
      variables: {
        platform: "${local.platform}",
      },
    }

    process.env.TEST_ENV_VAR = "foo"

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      environments: [
        {
          name: "default",
          namespacing: "optional",
          production: false,
          providers: [],
          variables: {
            envVar: "foo",
          },
        },
      ],
      outputs: [],
      sources: [
        {
          name: "foo",
          repositoryUrl,
        },
      ],
      varfile: defaultVarfilePath,
      variables: {
        platform: platform(),
      },
    })

    delete process.env.TEST_ENV_VAR
  })

  it("should pass through templated fields on provider configs", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {
            envVar: "foo",
          },
        },
      ],
      providers: [
        {
          name: "provider-a",
          someKey: "${local.env.TEST_ENV_VAR_A}",
        },
        {
          name: "provider-b",
          environments: ["default"],
          someKey: "${local.env.TEST_ENV_VAR_B}",
        },
      ],
      variables: {},
    }

    process.env.TEST_ENV_VAR_A = "foo"
    process.env.TEST_ENV_VAR_B = "boo"

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      environments: [
        {
          name: "default",
          namespacing: "optional",
          production: false,
          providers: [],
          variables: {
            envVar: "foo",
          },
        },
      ],
      outputs: [],
      providers: [
        {
          name: "provider-a",
          someKey: "${local.env.TEST_ENV_VAR_A}",
        },
        {
          name: "provider-b",
          environments: ["default"],
          someKey: "${local.env.TEST_ENV_VAR_B}",
        },
      ],
      sources: [],
      varfile: defaultVarfilePath,
    })

    delete process.env.TEST_ENV_VAR_A
    delete process.env.TEST_ENV_VAR_B
  })

  it("should set defaultEnvironment to first environment if not configured", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [],
      outputs: [],
      providers: [{ name: "some-provider" }],
      variables: {},
    }

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      defaultEnvironment: "local",
      environments: defaultEnvironments,
      sources: [],
      varfile: defaultVarfilePath,
    })
  })

  it("should populate default values in the schema", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [],
      outputs: [],
      providers: [{ name: "some-provider" }],
      variables: {},
    }

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      defaultEnvironment: "local",
      environments: defaultEnvironments,
      sources: [],
      varfile: defaultVarfilePath,
    })
  })

  it("should include providers in correct precedency order from all possible config keys", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {
            envVar: "foo",
          },
        },
      ],
      outputs: [],
      providers: [
        {
          name: "provider-a",
        },
        {
          name: "provider-b",
          environments: ["default"],
        },
        {
          name: "provider-c",
        },
      ],
      variables: {},
    }

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      environments: [
        {
          name: "default",
          namespacing: "optional",
          production: false,
          providers: [],
          variables: {
            envVar: "foo",
          },
        },
      ],
      outputs: [],
      providers: [
        {
          name: "provider-a",
        },
        {
          name: "provider-b",
          environments: ["default"],
        },
        {
          name: "provider-c",
        },
      ],
      sources: [],
      varfile: defaultVarfilePath,
    })
  })

  it("should convert old-style environment/provider config to the new canonical form", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          providers: [
            {
              name: "provider-b",
            },
          ],
          variables: {
            envVar: "bar",
          },
        },
      ],
      outputs: [],
      providers: [
        {
          name: "provider-a",
        },
      ],
      variables: {
        defaultVar: "foo",
      },
    }

    expect(resolveProjectConfig(config, "/tmp", "some-user")).to.eql({
      ...config,
      environments: [
        {
          name: "default",
          namespacing: "optional",
          providers: [],
          production: false,
          variables: {
            envVar: "bar",
          },
        },
      ],
      outputs: [],
      providers: [
        {
          name: "provider-a",
        },
        {
          name: "provider-b",
          environments: ["default"],
        },
      ],
      sources: [],
      varfile: defaultVarfilePath,
      variables: {
        defaultVar: "foo",
      },
    })
  })
})

describe("pickEnvironment", () => {
  let tmpDir: tmp.DirectoryResult
  let tmpPath: string

  beforeEach(async () => {
    tmpDir = await tmp.dir({ unsafeCleanup: true })
    tmpPath = await realpath(tmpDir.path)
  })

  afterEach(async () => {
    await tmpDir.cleanup()
  })

  it("should throw if selected environment isn't configured", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      providers: [],
      variables: {},
    }

    await expectError(() => pickEnvironment(config, "foo"), "parameter")
  })

  it("should include fixed providers in output", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      providers: [],
      variables: {},
    }

    expect(await pickEnvironment(config, "default")).to.eql({
      environmentName: "default",
      namespace: undefined,
      providers: [{ name: "exec" }, { name: "container" }],
      production: false,
      variables: {},
    })
  })

  it("should correctly merge provider configurations using JSON Merge Patch", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      providers: [
        { name: "container", newKey: "foo" },
        { name: "my-provider", a: "a" },
        { name: "my-provider", b: "b" },
        { name: "my-provider", a: "c" },
      ],
      variables: {},
    }

    expect(await pickEnvironment(config, "default")).to.eql({
      environmentName: "default",
      namespace: undefined,
      providers: [{ name: "exec" }, { name: "container", newKey: "foo" }, { name: "my-provider", a: "c", b: "b" }],
      production: false,
      variables: {},
    })
  })

  it("should remove null values in provider configs (as per the JSON Merge Patch spec)", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      providers: [
        { name: "container", newKey: "foo" },
        { name: "my-provider", a: "a" },
        { name: "my-provider", b: "b" },
        { name: "my-provider", a: null },
      ],
      variables: {},
    }

    expect(await pickEnvironment(config, "default")).to.eql({
      environmentName: "default",
      namespace: undefined,
      providers: [{ name: "exec" }, { name: "container", newKey: "foo" }, { name: "my-provider", b: "b" }],
      production: false,
      variables: {},
    })
  })

  it("should correctly merge project and environment variables", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {
            b: "env value B",
            c: "env value C",
            array: [{ envArrayKey: "env array value" }],
            nested: {
              nestedB: "nested env value B",
              nestedC: "nested env value C",
            },
          },
        },
      ],
      providers: [],
      variables: {
        a: "project value A",
        b: "project value B",
        array: [{ projectArrayKey: "project array value" }],
        nested: {
          nestedA: "nested project value A",
          nestedB: "nested project value B",
        },
      },
    }

    const result = await pickEnvironment(config, "default")

    expect(result.variables).to.eql({
      a: "project value A",
      b: "env value B",
      c: "env value C",
      array: [{ envArrayKey: "env array value", projectArrayKey: "project array value" }],
      nested: {
        nestedA: "nested project value A",
        nestedB: "nested env value B",
        nestedC: "nested env value C",
      },
    })
  })

  it("should load variables from default project varfile if it exists", async () => {
    const varfilePath = resolve(tmpPath, defaultVarfilePath)
    await writeFile(
      varfilePath,
      dedent`
      a=a
      b=b
    `
    )

    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {
            b: "B",
            c: "c",
          },
        },
      ],
      providers: [],
      variables: {},
    }

    const result = await pickEnvironment(config, "default")

    expect(result.variables).to.eql({
      a: "a",
      b: "B",
      c: "c",
    })
  })

  it("should load variables from default environment varfile if it exists", async () => {
    const varfilePath = resolve(tmpPath, defaultEnvVarfilePath("default"))
    await writeFile(
      varfilePath,
      dedent`
      b=B
      c=c
    `
    )

    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {},
        },
      ],
      providers: [],
      variables: {
        a: "a",
        b: "b",
      },
    }

    const result = await pickEnvironment(config, "default")

    expect(result.variables).to.eql({
      a: "a",
      b: "B",
      c: "c",
    })
  })

  it("should load variables from custom project varfile if specified", async () => {
    const varfilePath = resolve(tmpPath, "foo.env")
    await writeFile(
      varfilePath,
      dedent`
      a=a
      b=b
    `
    )

    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {
            b: "B",
            c: "c",
          },
        },
      ],
      providers: [],
      varfile: "foo.env",
      variables: {},
    }

    const result = await pickEnvironment(config, "default")

    expect(result.variables).to.eql({
      a: "a",
      b: "B",
      c: "c",
    })
  })

  it("should load variables from custom environment varfile if specified", async () => {
    const varfilePath = resolve(tmpPath, "foo.env")
    await writeFile(
      varfilePath,
      dedent`
      b=B
      c=c
    `
    )

    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          varfile: "foo.env",
          variables: {},
        },
      ],
      providers: [],
      variables: {
        a: "a",
        b: "b",
      },
    }

    const result = await pickEnvironment(config, "default")

    expect(result.variables).to.eql({
      a: "a",
      b: "B",
      c: "c",
    })
  })

  it("should correctly merge all variable sources in precedence order (variables fields and varfiles)", async () => {
    // Precedence 1/4 (highest)
    await writeFile(
      resolve(tmpPath, defaultEnvVarfilePath("default")),
      dedent`
      d=D
      e=e
    `
    )

    // Precedence 3/4
    await writeFile(
      resolve(tmpPath, defaultVarfilePath),
      dedent`
      b=B
      c=c
    `
    )

    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          // Precedence 2/4
          variables: {
            c: "C",
            d: "d",
          },
        },
      ],
      providers: [],
      // Precedence 4/4 (lowest)
      variables: {
        a: "a",
        b: "b",
      },
    }

    const result = await pickEnvironment(config, "default")

    expect(result.variables).to.eql({
      a: "a",
      b: "B",
      c: "C",
      d: "D",
      e: "e",
    })
  })

  it("should throw if project varfile is set to non-default and it doesn't exist", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          variables: {},
        },
      ],
      providers: [],
      varfile: "foo.env",
      variables: {},
    }

    await expectError(
      () => pickEnvironment(config, "default"),
      (err) => expect(err.message).to.equal("Could not find varfile at path 'foo.env'")
    )
  })

  it("should throw if environment varfile is set to non-default and it doesn't exist", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [
        {
          name: "default",
          varfile: "foo.env",
          variables: {},
        },
      ],
      providers: [],
      variables: {},
    }

    await expectError(
      () => pickEnvironment(config, "default"),
      (err) => expect(err.message).to.equal("Could not find varfile at path 'foo.env'")
    )
  })

  it("should set environment namespace if specified", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      providers: [],
      variables: {},
    }

    expect(await pickEnvironment(config, "foo.default")).to.eql({
      environmentName: "default",
      namespace: "foo",
      providers: [{ name: "exec" }, { name: "container" }],
      production: false,
      variables: {},
    })
  })

  it("should throw if invalid environment is specified", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", variables: {} }],
      providers: [],
      variables: {},
    }

    await expectError(
      () => pickEnvironment(config, "$.%"),
      (err) =>
        expect(err.message).to.equal(
          "Invalid environment specified ($.%): must be a valid environment name or <namespace>.<environment>"
        )
    )
  })

  it("should throw if environment requires namespace but none is specified", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", namespacing: "required", variables: {} }],
      providers: [],
      variables: {},
    }

    await expectError(
      () => pickEnvironment(config, "default"),
      (err) => expect(err.message).to.equal("Environment default requires a namespace, but none was specified.")
    )
  })

  it("should throw if environment doesn't allow namespacing but one is specified", async () => {
    const config: ProjectConfig = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "my-project",
      path: "/tmp/foo",
      defaultEnvironment: "default",
      dotIgnoreFiles: defaultDotIgnoreFiles,
      environments: [{ name: "default", namespacing: "disabled", variables: {} }],
      providers: [],
      variables: {},
    }

    await expectError(
      () => pickEnvironment(config, "foo.default"),
      (err) =>
        expect(err.message).to.equal(
          "Environment default does not allow namespacing, but namespace 'foo' was specified."
        )
    )
  })
})

describe("parseEnvironment", () => {
  it("should correctly parse with no namespace", () => {
    const result = parseEnvironment("env")
    expect(result).to.eql({ environment: "env" })
  })

  it("should correctly parse with a namespace", () => {
    const result = parseEnvironment("ns.env")
    expect(result).to.eql({ environment: "env", namespace: "ns" })
  })

  it("should throw if string contains more than two segments", () => {
    expectError(
      () => parseEnvironment("a.b.c"),
      (err) =>
        expect(err.message).to.equal("Invalid environment specified (a.b.c): may only contain a single delimiter")
    )
  })

  it("should throw if string is not a valid hostname", () => {
    expectError(
      () => parseEnvironment("&.$"),
      (err) =>
        expect(err.message).to.equal(
          "Invalid environment specified (&.$): must be a valid environment name or <namespace>.<environment>"
        )
    )
  })
})
