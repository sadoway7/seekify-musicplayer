/* ── DB public API — assembles all modules ──────────────────── */

const DB = (() => {
  return {
    // core
    open: DBCore.open, saveNow: DBCore.saveNow, isReady: DBCore.isReady, getLastUpdated: DBCore.getLastUpdated,
    getMeta: DBCore.getMeta, setMeta: DBCore.setMeta, exportDB: DBCore.exportDB, isDirty: DBCore.isDirty,
    // items
    getAll: DBItems.getAll, getById: DBItems.getById, getItemCount: DBItems.getCount,
    getActive: DBItems.getActive, getArchived: DBItems.getArchived, getFiltered: DBItems.getFiltered,
    findBySerial: DBItems.findBySerial, isArchiveStatus: DBItems.isArchiveStatus, isDeleted: DBItems.isDeleted,
    addItem: DBItems.addItem, updateItem: DBItems.updateItem, deleteItem: DBItems.deleteItem, deleteItems: DBItems.deleteItems,
    getStats: DBItems.getStats,
    // history
    getHistory: DBHistory.getForItem, getAllActivity: DBHistory.getAll,
    // lists
    getCategories: DBLists.getCategories, getCategoriesWithSubs: DBLists.getCategoriesWithSubs,
    getSubCategories: DBLists.getSubCategories, addCategory: DBLists.addCategory,
    updateCategory: DBLists.updateCategory, deleteCategory: DBLists.deleteCategory,
    getLocations: DBLists.getLocations, getLocationsWithAccount: DBLists.getLocationsWithAccount, getLocationsForAccount: DBLists.getLocationsForAccount, addLocation: DBLists.addLocation, updateLocation: DBLists.updateLocation, deleteLocation: DBLists.deleteLocation,
    getStatuses: DBLists.getStatuses, getStatusColor: DBLists.getStatusColor, addStatus: DBLists.addStatus, deleteStatus: DBLists.deleteStatus,
    getOwners: DBLists.getOwners, getAccounts: DBLists.getAccounts, addAccount: DBLists.addAccount,
    updateAccount: DBLists.updateAccount, deleteAccount: DBLists.deleteAccount,
    // contacts (people)
    getContacts: DBContacts.getAll, getContactsByAccount: DBContacts.getByAccount,
    getContactByName: DBContacts.getByName, getContactById: DBContacts.getById,
    addContact: DBContacts.add, updateContact: DBContacts.update, deleteContact: DBContacts.deleteContact,
    getContactNames: DBContacts.getAllNames, getContactNamesForAccount: DBContacts.getNamesForAccount,
    searchContacts: DBContacts.searchContacts,
    // import/export
    exportCSV: DBImportExport.exportCSV, importItems: DBImportExport.importItems,
    getTemplateCSV: DBImportExport.getTemplateCSV, exportActivityCSV: DBImportExport.exportActivityCSV,
    // reset
    reset: DBSchema.reset,
    // tags
    getTags: DBTags.getAll,
  };
})();
