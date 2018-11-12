import { fromJS } from 'immutable';
import templatesAPI from 'api/templates';
import settings from 'api/settings';
import relationtypes from 'api/relationtypes';
import { generateNamesAndIds } from '../templates/utils';
import entities from 'api/entities/entities';

import model from './model';
import search from '../search/search';
import { generateID } from 'api/odm';
import { createError } from 'api/utils';

import { filterRelevantRelationships, groupRelationships } from './groupByRelationships';

const normalizeConnectedDocumentData = (relationship, connectedDocument) => {
  relationship.entityData = connectedDocument;
  return relationship;
};

function excludeRefs(template) {
  delete template.refs;
  return template;
}

function getPropertiesToBeConnections(template) {
  return template.properties.filter(prop => prop.type === 'relationship');
}

function groupByHubs(references) {
  const hubs = references.reduce((_hubs, reference) => {
    if (!_hubs[reference.hub]) {
      _hubs[reference.hub] = [];
    }
    _hubs[reference.hub].push(reference);
    return _hubs;
  }, []);
  return Object.keys(hubs).map(key => hubs[key]);
}

function findPropertyHub(propertyRelationType, hubs, entitySharedId) {
  return hubs.reduce((result, hub) => {
    const allReferencesAreOfTheType = hub.every(
      reference => reference.entity === entitySharedId ||
      (reference.template && reference.template.toString() === propertyRelationType)
    );
    if (allReferencesAreOfTheType) {
      return hub;
    }

    return result;
  }, null);
}

function determineDeleteAction(hubId, relation, relationQuery) {
  let deleteQuery = relationQuery;
  // if (relationQuery._id) {
  //   deleteQuery = { _id: relationQuery._id };
  // }

  return model.delete(deleteQuery);
}

// Code mostly copied from react/Relationships/reducer/hubsReducer.js, abstract this QUICKLY!
const conformRelationships = (rows, parentEntitySharedId) => {
  let order = -1;
  const hubsObject = fromJS(rows)
  .reduce((hubs, row) => {
    let hubsImmutable = hubs;
    row.get('connections').forEach((connection) => {
      const hubId = connection.get('hub').toString();
      if (!hubsImmutable.has(hubId)) {
        order += 1;
        hubsImmutable = hubsImmutable.set(hubId, fromJS({ hub: hubId, order, leftRelationship: {}, rightRelationships: {} }));
      }

      if (row.get('sharedId') === parentEntitySharedId) {
        hubsImmutable = hubsImmutable.setIn([hubId, 'leftRelationship'], connection);
      } else {
        const templateId = connection.get('template');
        if (!hubsImmutable.getIn([hubId, 'rightRelationships']).has(templateId)) {
          hubsImmutable = hubsImmutable.setIn([hubId, 'rightRelationships', templateId], fromJS([]));
        }
        const newConnection = connection.set('entity', row.delete('connections'));
        hubsImmutable = hubsImmutable.setIn([hubId, 'rightRelationships', templateId],
                                             hubsImmutable.getIn([hubId, 'rightRelationships', templateId]).push(newConnection));
      }
    });

    return hubsImmutable;
  }, fromJS({}));

  return hubsObject.reduce((hubs, hub) => {
    const rightRelationships = hub.get('rightRelationships').reduce((memo, relationshipsArray, template) => {
      const newMemo = memo.push(fromJS({}).set('template', template).set('relationships', relationshipsArray));
      return newMemo;
    }, fromJS([]));
    return hubs.set(hub.get('order'), hub.set('rightRelationships', rightRelationships));
  }, fromJS([]));
};

const limitRelationshipResults = (results, entitySharedId, hubsLimit) => {
  const hubs = conformRelationships(results.rows, entitySharedId).toJS();
  results.totalHubs = hubs.length;
  results.requestedHubs = Number(hubsLimit);

  if (hubsLimit) {
    const hubsToReturn = hubs.slice(0, hubsLimit).map(h => h.hub.toString());
    results.rows = results.rows.reduce((limitedResults, row) => {
      let rowInHubsToReturn = false;
      row.connections = row.connections.reduce((limitedConnections, connection) => {
        if (hubsToReturn.indexOf(connection.hub.toString()) !== -1) {
          limitedConnections.push(connection);
          rowInHubsToReturn = true;
        }
        return limitedConnections;
      }, []);

      if (rowInHubsToReturn) {
        limitedResults.push(row);
      }

      return limitedResults;
    }, []);
  }

  return results;
};

export default {
  get(query, select, pagination) {
    return model.get(query, select, pagination);
  },

  getById(id) {
    return model.getById(id);
  },

  getDocumentHubs(id, language) {
    return model.get({ entity: id, language })
    .then((ownRelations) => {
      const hubsIds = ownRelations.map(relationship => relationship.hub);
      return model.db.aggregate([
        { $match: { hub: { $in: hubsIds }, language } },
        { $group: {
          _id: '$hub',
          relationships: { $push: '$$ROOT' },
          count: { $sum: 1 }
        } }
      ]);
    })
    .then(hubs => hubs.filter(hub => hub.count > 1));
  },

  getByDocument(id, language, withEntityData = true) {
    return this.getDocumentHubs(id, language)
    .then((hubs) => {
      const relationships = Array.prototype.concat(...hubs.map(hub => hub.relationships));
      const connectedEntityiesSharedId = relationships.map(relationship => relationship.entity);
      return entities.get({ sharedId: { $in: connectedEntityiesSharedId }, language })
      .then((_connectedDocuments) => {
        const connectedDocuments = _connectedDocuments.reduce((res, doc) => {
          res[doc.sharedId] = doc;
          return res;
        }, {});
        return relationships.map((_relationship) => {
          const relationship = Object.assign({}, { template: null }, _relationship);

          if (withEntityData) {
            return normalizeConnectedDocumentData(relationship, connectedDocuments[relationship.entity]);
          }
          return relationship;
        });
      });
    });
  },

  getGroupsByConnection(id, language, options = {}) {
    return Promise.all([
      this.getByDocument(id, language),
      templatesAPI.get(),
      relationtypes.get()
    ])
    .then(([references, templates, relationTypes]) => {
      const relevantReferences = filterRelevantRelationships(references, id, language, options.user);
      const groupedReferences = groupRelationships(relevantReferences, templates, relationTypes);

      if (options.excludeRefs) {
        groupedReferences.forEach((g) => {
          g.templates = g.templates.map(excludeRefs);
        });
      }
      return groupedReferences;
    });
  },

  getHub(hub) {
    return model.get({ hub });
  },

  countByRelationType(typeId) {
    return model.count({ template: typeId });
  },

  getAllLanguages(sharedId) {
    return model.get({ sharedId });
  },

  async bulk(bulkData, language) {
    await Promise.all(bulkData.save.map(reference => this.save(reference, language)));
    await Promise.all(bulkData.delete.map(reference => this.delete(reference, language)));
    return { success: 'ok' };
  },

  async createRelationship(relationship, language) {
    const isATextReference = relationship.range;
    let filename;
    if (isATextReference) {
      const [entity] = await entities.get({ sharedId: relationship.entity, language });
      ({ filename } = entity.file);
    }

    return model.save({ ...relationship, filename });
  },

  async updateRelationship(relationship) {
    return model.save({
      ...relationship,
      template: relationship.template && relationship.template._id !== null ? relationship.template : null
    });
  },

  save(_relationships, language, updateMetdata = true) {
    if (!language) {
      return Promise.reject(createError('Language cant be undefined'));
    }
    let relationships = _relationships;
    if (!Array.isArray(relationships)) {
      relationships = [relationships];
    }

    if (relationships.length === 1 && !relationships[0].hub) {
      return Promise.reject(createError('Single relationships must have a hub'));
    }
    const hub = relationships[0].hub || generateID();
    return Promise.all(
      relationships.map((relationship) => {
        let action;
        relationship.hub = hub;
        if (relationship._id) {
          action = this.updateRelationship(relationship);
        } else {
          action = this.createRelationship(relationship, language);
        }

        return action
        .then(savedRelationship => Promise.all([savedRelationship, entities.getById(savedRelationship.entity, language)]))
        .then(([result, connectedEntity]) => {
          if (updateMetdata) {
            return this.updateEntitiesMetadataByHub(hub, language)
            .then(() => normalizeConnectedDocumentData(result, connectedEntity));
          }
          return normalizeConnectedDocumentData(result, connectedEntity);
        });
      })
    );
  },

  updateEntitiesMetadataByHub(hubId, language) {
    return this.getHub(hubId)
    .then(hub => entities.updateMetdataFromRelationships(hub.map(r => r.entity), language));
  },

  updateEntitiesMetadata(entitiesIds, language) {
    return entities.updateMetdataFromRelationships(entitiesIds, language);
  },

  saveEntityBasedReferences(entity, language) {
    if (!language) {
      return Promise.reject(createError('Language cant be undefined'));
    }
    if (!entity.template) {
      return Promise.resolve([]);
    }

    return templatesAPI.getById(entity.template)
    .then(getPropertiesToBeConnections)
    .then(properties => Promise.all([properties, this.getByDocument(entity.sharedId, language)]))
    .then(([properties, references]) => Promise.all(properties.map((property) => {
      let propertyValues = entity.metadata[property.name] || [];
      if (typeof propertyValues === 'string') {
        propertyValues = [propertyValues];
      }
      const hubs = groupByHubs(references);
      const propertyRelationType = property.relationType.toString();
      const entityType = property.content;
      let hub = findPropertyHub(propertyRelationType, hubs, entity.sharedId);
      if (!hub) {
        hub = [{ entity: entity.sharedId, hub: generateID() }];
      }

      const referencesOfThisType = references.filter(reference =>
        reference.template &&
          reference.template.toString() === propertyRelationType.toString()
      );

      propertyValues.forEach((entitySharedId) => {
        const relationshipDoesNotExists = !referencesOfThisType.find(reference => reference.entity === entitySharedId);
        if (relationshipDoesNotExists) {
          hub.push({ entity: entitySharedId, hub: hub[0].hub, template: propertyRelationType });
        }
      });
      const referencesToBeDeleted = references.filter(reference => !(reference.entity === entity.sharedId) &&
          reference.template && reference.template.toString() === propertyRelationType &&
          (!entityType || reference.entityData.template.toString() === entityType) &&
          !propertyValues.includes(reference.entity));

      let save = Promise.resolve();
      if (hub.length > 1) {
        save = this.save(hub, language, false);
      }

      return save.then(() => Promise.all(referencesToBeDeleted.map(reference => this.delete({ _id: reference._id }, language, false))));
    })));
  },

  search(entitySharedId, query, language, user) {
    const hubsLimit = query.limit || 0;

    if (!language) {
      return Promise.reject(createError('Language cant be undefined'));
    }
    return Promise.all([this.getByDocument(entitySharedId, language), entities.getById(entitySharedId, language)])
    .then(([relationships, entity]) => {
      relationships.sort((a, b) => (a.entity + a.hub.toString()).localeCompare(b.entity + b.hub.toString()));

      const filter = Object.keys(query.filter).reduce((result, filterGroupKey) => result.concat(query.filter[filterGroupKey]), []);
      const filteredRelationships = relationships.filter(relationship =>
        !filter.length ||
        filter.includes(relationship.template + relationship.entityData.template)
      );

      const ids = filteredRelationships
      .map(relationship => relationship.entity)
      .reduce((result, id) => {
        if (!result.includes(id) && id !== entitySharedId) {
          result.push(id);
        }
        return result;
      }, []);
      query.ids = ids.length ? ids : ['no_results'];
      query.includeUnpublished = true;
      query.limit = 9999;
      delete query.filter;

      return search.search(query, language, user)
      .then((results) => {
        results.rows.forEach((item) => {
          item.connections = filteredRelationships.filter(relationship => relationship.entity === item.sharedId);
        });

        if (results.rows.length) {
          let filteredRelationshipsHubs = results.rows.map(item => item.connections.map(relationship => relationship.hub.toString()));
          filteredRelationshipsHubs = Array.prototype.concat(...filteredRelationshipsHubs);
          entity.connections = relationships.filter(relationship =>
            relationship.entity === entitySharedId &&
            filteredRelationshipsHubs.includes(relationship.hub.toString())
          );
          results.rows.push(entity);
        }


        return limitRelationshipResults(results, entitySharedId, hubsLimit);
      });
    });
  },

  async delete(relationQuery, language, updateMetdata = true) {
    if (!relationQuery) {
      return Promise.reject(createError('Cant delete without a condition'));
    }

    const unique = (elem, pos, arr) => arr.indexOf(elem) === pos;
    const relationsToDelete = await model.get(relationQuery, 'hub');
    const hubsAffected = relationsToDelete.map(r => r.hub).filter(unique);

    const { languages } = await settings.get();
    const entitiesAffected = await model.db.aggregate([
      { $match: { hub: { $in: hubsAffected } } },
      { $group: { _id: '$entity' } },
    ]);

    const response = await model.delete(relationQuery);

    const hubsToDelete = await model.db.aggregate([
      { $match: { hub: { $in: hubsAffected } } },
      { $group: { _id: '$hub', length: { $sum: 1 } } },
      { $match: { length: { $lt: 2 } } }
    ]);

    await model.delete({ hub: { $in: hubsToDelete.map(h => h._id) } });

    if (updateMetdata) {
      await Promise.all(languages.map(l => this.updateEntitiesMetadata(entitiesAffected.map(e => e._id), l.key)));
    }

    return response;
  },

  deleteTextReferences(sharedId, language) {
    return model.delete({ entity: sharedId, language, range: { $exists: true } });
  },

  updateMetadataProperties(template, currentTemplate) {
    const actions = {};
    actions.$rename = {};
    actions.$unset = {};
    template.properties = generateNamesAndIds(template.properties);
    template.properties.forEach((property) => {
      const currentProperty = currentTemplate.properties.find(p => p.id === property.id);
      if (currentProperty && currentProperty.name !== property.name) {
        actions.$rename[`metadata.${currentProperty.name}`] = `metadata.${property.name}`;
      }
    });
    currentTemplate.properties = currentTemplate.properties || [];
    currentTemplate.properties.forEach((property) => {
      if (!template.properties.find(p => p.id === property.id)) {
        actions.$unset[`metadata.${property.name}`] = '';
      }
    });

    const noneToUnset = !Object.keys(actions.$unset).length;
    const noneToRename = !Object.keys(actions.$rename).length;

    if (noneToUnset) {
      delete actions.$unset;
    }
    if (noneToRename) {
      delete actions.$rename;
    }

    if (noneToRename && noneToUnset) {
      return Promise.resolve();
    }

    return model.db.updateMany({ template }, actions);
  },

  count: model.count
};
