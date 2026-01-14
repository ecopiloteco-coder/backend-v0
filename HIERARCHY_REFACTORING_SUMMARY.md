# Project Details Hierarchy Refactoring Summary

## Overview
This refactoring implements a new standardized hierarchy for the Eco-pilot project details feature while maintaining backward compatibility.

## New Hierarchy Model
**Application Logic**: Project → GBloc → Bloc → Articles
**Database Storage**: Single `projet_article` table with composite key structure

### Key Concepts
- **GBloc**: Combination of (`niv_1` + `lot` + `gbloc` from Niveau_3)
- **Bloc**: Combination of (`niv_1` + `lot` + `gbloc` + `bloc` from Niveau_4)
- **Lot**: Used only for UI navigation/tabs, NOT as a tree level
- **ProjectArticle**: Single row in `projet_article` represents one article with full path

## New Files Created

### 1. HierarchyService.js (`src/services/HierarchyService.js`)
**Purpose**: Core service for grouping `projet_article` rows by composite keys

**Key Methods**:
- `getProjectLots()` - Get lots for UI tabs
- `getProjectGblocs()` - Get GBlocs grouped by niv_1 + lot + gbloc
- `getGblocBlocs()` - Get Blocs within a GBloc
- `getBlocArticles()` - Get articles within a Bloc
- `createGbloc()` - Create new GBloc with hierarchy validation
- `createBloc()` - Create new Bloc within GBloc
- `getProjectTotals()` - Aggregate project totals
- `deleteGbloc()` / `deleteBloc()` - Delete operations with cleanup

### 2. ProjectArticle.js (`src/models/ProjectArticle.js`)
**Purpose**: Centralized CRUD operations for `projet_article` entries

**Key Methods**:
- `create()` - Create with hierarchy validation
- `update()` - Update with validation
- `delete()` - Delete with cleanup
- `findById()` - Find with full details
- `findByHierarchy()` - Query by hierarchy level
- `getHierarchyTotals()` - Aggregated totals by level
- `searchCatalogue()` - Search articles for adding
- `addCatalogueArticle()` - Add catalogue article to hierarchy
- `validateHierarchy()` - Enforces allowed null combinations

## New API Endpoints

### Hierarchy Management
```
GET    /api/projects/:id/lots                    - Get project lots (tabs)
GET    /api/projects/:id/gblocs                  - Get project GBlocs
POST   /api/projects/:id/gblocs                  - Create new GBloc
GET    /api/projects/:id/gblocs/:gblocKey/blocs  - Get Blocs in GBloc
POST   /api/projects/:id/gblocs/:gblocKey/blocs  - Create Bloc in GBloc
DELETE /api/projects/:id/gblocs/:gblocKey        - Delete GBloc
DELETE /api/projects/:id/blocs/:blocKey          - Delete Bloc
```

### Article Management
```
GET    /api/projects/:id/blocs/:blocKey/articles - Get articles in Bloc
POST   /api/projects/:id/blocs/:blocKey/articles - Add article to Bloc
PUT    /api/projects/:id/articles/:articleId    - Update article
DELETE /api/projects/:id/articles/:articleId    - Delete article
```

### Catalogue & Totals
```
GET    /api/projects/:id/catalogue/search       - Search catalogue
GET    /api/projects/:id/totals                  - Get project totals
```

## URL Key Format
Hierarchy keys are encoded in URLs as:
- **GBloc Key**: `niv_1:lot:gbloc`
- **Bloc Key**: `niv_1:lot:gbloc:bloc`

Example: `/api/projects/123/gblocs/Infrastructure:Lot1:Foundation/blocs`

## Database Rules Enforced

### Allowed Null Combinations
1. `niv_1` only
2. `niv_1` + `lot`
3. `niv_1` + `lot` + `gbloc`
4. `niv_1` + `lot` + `gbloc` + `bloc`
5. Full path with article details

### Validation Rules
- `niv_1` is always required
- No gaps allowed in hierarchy (can't have article without bloc, etc.)
- `lot` is required for GBloc but used only for navigation

## Backward Compatibility

### Legacy Routes Preserved
- Original `/gblocs` routes moved to `/gblocs/legacy`
- Existing controller methods unchanged
- Current frontend continues to work

### Migration Path
1. New hierarchy endpoints available immediately
2. Frontend can migrate gradually
3. Legacy endpoints can be deprecated after migration

## Integration Points

### Existing Models Updated
- `projectRoutes.js` - Added new hierarchy endpoints
- Maintained all existing functionality
- Added imports for new services

### Event System
- Compatible with existing `EventNotificationService`
- Maintains audit trail for hierarchy operations

## Usage Examples

### Get Project Structure
```javascript
// Get lots for tabs
GET /api/projects/123/lots

// Get GBlocs (with totals)
GET /api/projects/123/gblocs?includeTotals=true&includeCounts=true

// Get Blocs in specific GBloc
GET /api/projects/123/gblocs/Infrastructure:Lot1:Foundation/blocs
```

### Create Hierarchy
```javascript
// Create GBloc
POST /api/projects/123/gblocs
{
  "niv_1": "Infrastructure",
  "lot": "Lot1", 
  "gbloc": "Foundation",
  "gbloc_name": "Foundation Works"
}

// Create Bloc in GBloc
POST /api/projects/123/gblocs/Infrastructure:Lot1:Foundation/blocs
{
  "bloc": "Concrete",
  "bloc_name": "Concrete Works"
}
```

### Add Articles
```javascript
// Search catalogue
GET /api/projects/123/catalogue/search?searchText=concrete&niv_1=Infrastructure

// Add article to bloc
POST /api/projects/123/blocs/Infrastructure:Lot1:Foundation:Concrete/articles
{
  "catalogueId": 456,
  "quantity": 100,
  "tva": 20
}
```

## Benefits

1. **Single Source of Truth**: All hierarchy data in `projet_article`
2. **Consistent API**: Standardized endpoint patterns
3. **Validation**: Enforced data integrity rules
4. **Performance**: Optimized queries with proper aggregation
5. **Flexibility**: Lot as navigation concept, not tree level
6. **Backward Compatible**: No breaking changes to existing code

## Next Steps for Frontend

1. Update project details UI to use new hierarchy endpoints
2. Implement lot-based navigation tabs
3. Update article management to use new CRUD endpoints
4. Migrate from legacy endpoints gradually
5. Remove legacy endpoints after migration complete

## Testing Recommendations

1. Test hierarchy validation with invalid combinations
2. Verify aggregation totals match existing calculations
3. Test concurrent operations on same hierarchy
4. Verify performance with large project datasets
5. Test backward compatibility with existing frontend
