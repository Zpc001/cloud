package store_test

import (
	"errors"
	"testing"

	"github.com/wanglongan587/cloud/v2-server/internal/store"
)

func TestPluginMarketLifecycle(t *testing.T) {
	f := newSquadFixture(t)
	ctx := f.ctx
	owner := f.login(t, "owner", "owner")
	member := f.login(t, "member", "member")
	spaces, e := f.store.TenantSpaces(ctx, f.tenant, owner)
	if e != nil || len(spaces) != 1 {
		t.Fatalf("spaces = %v %v", spaces, e)
	}
	space := spaces[0].ID
	path := "/api/v1/tenants/" + f.tenant + "/spaces/" + space + "/plugins"

	catalog, syncedAt, e := f.store.PluginCatalog(ctx, f.tenant, space, owner)
	if e != nil {
		t.Fatal(e)
	}
	if syncedAt.IsZero() || len(catalog) < 8 {
		t.Fatalf("catalog = %d entries at %v", len(catalog), syncedAt)
	}
	kinds := map[string]bool{}
	for _, entry := range catalog {
		kinds[entry.Kind] = true
		if entry.ID == "demo/writing-kit" && entry.Readme == nil {
			t.Fatalf("writing-kit has no document: %+v", entry)
		}
	}
	for _, kind := range []string{"agent", "skill", "mcp", "webview", "pack"} {
		if !kinds[kind] {
			t.Fatalf("catalog is missing kind %q: %+v", kind, kinds)
		}
	}

	initial, e := f.store.SpacePlugins(ctx, f.tenant, space, member)
	if e != nil || len(initial) != 2 {
		t.Fatalf("initial selections = %+v %v", initial, e)
	}
	installed, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, owner, path, "install-writing", store.PluginInstallInput{
		Identifier: "demo/writing-kit", PluginVersion: "1.2.0", Version: 0,
	})
	if e != nil {
		t.Fatal(e)
	}
	if installed.Kind != "skill" || installed.DesiredState != "installed" ||
		installed.ObservedState != "installed" || installed.ObservedVersion == nil ||
		*installed.ObservedVersion != "1.2.0" || installed.RequestedByUserID == nil ||
		*installed.RequestedByUserID != owner {
		t.Fatalf("installed = %+v", installed)
	}
	if _, e := f.store.CreateSquad(ctx, f.tenant, owner, store.SquadInput{
		Name: "错误 Agent", LeaderAgentID: &installed.ID,
	}); !errors.Is(e, store.ErrAgentUnavailable) {
		t.Fatalf("skill as squad agent = %v", e)
	}

	// The same request replays without advancing the version; key reuse for another body conflicts.
	replayed, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, owner, path, "install-writing", store.PluginInstallInput{
		Identifier: "demo/writing-kit", PluginVersion: "1.2.0", Version: 0,
	})
	if e != nil || replayed.Version != installed.Version {
		t.Fatalf("replayed = %+v %v", replayed, e)
	}
	if _, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, owner, path, "install-writing", store.PluginInstallInput{
		Identifier: "demo/review-kit", Version: 0,
	}); !errors.Is(e, store.ErrIdempotencyConflict) {
		t.Fatalf("idempotency conflict = %v", e)
	}

	// Pack and Agent packages remain owned by the runtime/Agent path.
	if _, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, owner, path, "install-pack", store.PluginInstallInput{
		Identifier: "demo/starter-pack", Version: 0,
	}); !errors.Is(e, store.ErrPluginKindNotInstallable) {
		t.Fatalf("pack install = %v", e)
	}
	if _, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, owner, path, "install-agent", store.PluginInstallInput{
		Identifier: "official/ora-space.opencode", Version: 0,
	}); !errors.Is(e, store.ErrPluginKindNotInstallable) {
		t.Fatalf("agent install = %v", e)
	}
	if _, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, member, path, "member-install", store.PluginInstallInput{
		Identifier: "demo/review-kit", Version: 0,
	}); !errors.Is(e, store.ErrForbidden) {
		t.Fatalf("member install = %v", e)
	}

	removed, e := f.store.RemoveSpacePlugin(ctx, f.tenant, space, owner, path, "remove-writing", store.PluginRemoveInput{
		Identifier: "demo/writing-kit", Version: installed.Version,
	})
	if e != nil {
		t.Fatal(e)
	}
	if removed.DesiredState != "removed" || removed.ObservedState != "removed" || removed.ObservedVersion != nil {
		t.Fatalf("removed = %+v", removed)
	}
	if _, e := f.store.RemoveSpacePlugin(ctx, f.tenant, space, owner, path, "stale-remove", store.PluginRemoveInput{
		Identifier: "demo/writing-kit", Version: installed.Version,
	}); !errors.Is(e, store.ErrConflict) {
		t.Fatalf("stale removal = %v", e)
	}
	if _, e := f.store.RemoveSpacePlugin(ctx, f.tenant, space, member, path, "member-remove", store.PluginRemoveInput{
		Identifier: "demo/writing-kit", Version: removed.Version,
	}); !errors.Is(e, store.ErrForbidden) {
		t.Fatalf("member removal = %v", e)
	}

	mcp, e := f.store.InstallSpacePlugin(ctx, f.tenant, space, owner, path, "install-github", store.PluginInstallInput{
		Identifier: "demo/github-tools", Version: 0,
	})
	if e != nil {
		t.Fatal(e)
	}
	if mcp.Kind != "mcp" || mcp.ObservedState != "installed" || mcp.ObservedVersion == nil ||
		*mcp.ObservedVersion != "2.1.0" {
		t.Fatalf("mcp = %+v", mcp)
	}
	if _, e := f.store.RemoveSpacePlugin(ctx, f.tenant, space, owner, path, "remove-github", store.PluginRemoveInput{
		Identifier: "demo/github-tools", Version: mcp.Version,
	}); e != nil {
		t.Fatal(e)
	}

	selections, e := f.store.SpacePlugins(ctx, f.tenant, space, member)
	if e != nil {
		t.Fatal(e)
	}
	if len(selections) != 4 {
		t.Fatalf("selections after removal = %+v", selections)
	}
	agents, e := f.store.SpaceAgentPlugins(ctx, f.tenant, space, member)
	if e != nil || len(agents) != 2 {
		t.Fatalf("agent selections = %+v %v", agents, e)
	}
}
