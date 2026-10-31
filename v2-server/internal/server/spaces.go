package server

import (
	"errors"
	"net/http"

	"github.com/wanglongan587/cloud/v2-server/internal/store"
)

// spaces returns the caller's workspace spaces in one page. v2 has exactly one per tenant, so
// pagination is skipped; the squad member picker reads the first space's plugins.
func (h *handler) spaces(w http.ResponseWriter, r *http.Request, u store.User) {
	tenant := r.PathValue("tid")
	if !squadUUID.MatchString(tenant) {
		fault(w, http.StatusNotFound, "not_found")
		return
	}
	items, e := h.store.TenantSpaces(r.Context(), tenant, u.ID)
	if errors.Is(e, store.ErrNotFound) {
		fault(w, http.StatusForbidden, "forbidden")
		return
	}
	if e != nil {
		internal(w, "tenant spaces", e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "nextCursor": ""})
}
