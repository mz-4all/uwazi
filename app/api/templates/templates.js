/** @format */

import entities from 'api/entities';
import request from 'shared/JSONRequest.js';
import translations from 'api/i18n/translations';
import createError from 'api/utils/Error';
import { db_url as dbURL } from '../config/database.js';
import { generateNamesAndIds, getUpdatedNames, getDeletedProperties } from './utils';
import model from './templatesModel.js';
import { validateTemplate } from './templateSchema';

const removePropsWithUnexistentId = async unexistentId => {
  const relatedTemplates = await model.get({ 'properties.content': unexistentId });
  await Promise.all(
    relatedTemplates.map(t =>
      model.save({
        ...t,
        properties: t.properties.filter(prop => prop.content !== unexistentId),
      })
    )
  );
};

const createTranslationContext = template => {
  const titleProperty = template.commonProperties.find(p => p.name === 'title');
  const context = template.properties.reduce((ctx, prop) => {
    ctx[prop.label] = prop.label;
    return ctx;
  }, {});
  context[template.name] = template.name;
  context[titleProperty.label] = titleProperty.label;
  return context;
};

const addTemplateTranslation = template => {
  const context = createTranslationContext(template);
  return translations.addContext(template._id, template.name, context, 'Entity');
};

const updateTranslation = (currentTemplate, template) => {
  const currentProperties = currentTemplate.properties;
  const newProperties = template.properties;
  const updatedLabels = getUpdatedNames(currentProperties, newProperties, 'label');
  if (currentTemplate.name !== template.name) {
    updatedLabels[currentTemplate.name] = template.name;
  }
  const deletedPropertiesByLabel = getDeletedProperties(currentProperties, newProperties, 'label');
  const context = createTranslationContext(template);

  return translations.updateContext(
    currentTemplate._id,
    template.name,
    updatedLabels,
    deletedPropertiesByLabel,
    context,
    'Entity'
  );
};

export default {
  async save(template, language) {
    await validateTemplate(template);
    template.properties = template.properties || [];
    template.properties = generateNamesAndIds(template.properties);

    if (template._id) {
      return this._update(template, language);
    }
    return model
      .save(template)
      .then(newTemplate => addTemplateTranslation(newTemplate).then(() => newTemplate));
  },

  _validateSwapPropertyNames(currentTemplate, template) {
    currentTemplate.properties.forEach(prop => {
      const swapingNameWithExistingProperty = template.properties.find(
        p => p.name === prop.name && p.id !== prop.id
      );
      if (swapingNameWithExistingProperty) {
        throw createError(`Properties can't swap names: ${prop.name}`, 400);
      }
    });
  },

  async _removeValuesFromEntities(currentTemplate, template) {
    const currentTemplateContentProperties = currentTemplate.properties.filter(p => p.content);
    const templateContentProperties = template.properties.filter(p => p.content);
    const toRemoveValues = {};
    currentTemplateContentProperties.forEach(prop => {
      const sameProperty = templateContentProperties.find(p => p.id === prop.id);
      if (sameProperty && sameProperty.content !== prop.content) {
        toRemoveValues[sameProperty.name] = prop.type === 'multiselect' ? [] : '';
      }
    });
    if (Object.keys(toRemoveValues).length) {
      await entities.removeValuesFromEntities(toRemoveValues, currentTemplate._id);
    }
  },

  async _validateDeleteProperties(currentTemplate, template) {
    const toRemoveProperties = currentTemplate.properties.filter(
      prop => !template.properties.find(p => p._id === prop._id)
    );

    await Promise.all(
      toRemoveProperties.map(async prop => {
        const canDelete = await this.canDeleteProperty(template._id, prop._id);
        if (!canDelete) {
          throw createError(`Can't delte properties being inherited by others: ${prop.name}`, 400);
        }
      })
    );
  },

  async _update(template, language) {
    const currentTemplate = await this.getById(template._id);
    currentTemplate.properties = currentTemplate.properties || [];
    this._validateSwapPropertyNames(currentTemplate, template);
    await this._validateDeleteProperties(currentTemplate, template);
    this._removeValuesFromEntities(currentTemplate, template);
    await updateTranslation(currentTemplate, template);
    const savedTemplate = await model.save(template);
    await entities.updateMetadataProperties(template, currentTemplate, language);
    return savedTemplate;
  },

  async canDeleteProperty(template, property) {
    const tmps = await model.get();

    return tmps.every(iteratedTemplate =>
      iteratedTemplate.properties.every(
        iteratedProperty =>
          !iteratedProperty.content ||
          !iteratedProperty.inheritProperty ||
          !(
            iteratedProperty.content.toString() === template.toString() &&
            iteratedProperty.inheritProperty.toString() === property.toString()
          )
      )
    );
  },

  get(query) {
    return model.get(query);
  },

  setAsDefault(templateId) {
    return this.get().then(_templates => {
      const templateToBeDefault = _templates.find(t => t._id.toString() === templateId);
      const currentDefault = _templates.find(t => t.default);
      templateToBeDefault.default = true;
      let saveCurrentDefault = Promise.resolve();
      if (currentDefault) {
        currentDefault.default = false;
        saveCurrentDefault = this.save(currentDefault);
      }
      return Promise.all([this.save(templateToBeDefault), saveCurrentDefault]);
    });
  },

  getById(templateId) {
    return model.getById(templateId);
  },

  async delete(template) {
    const count = await this.countByTemplate(template._id);
    if (count > 0) {
      return Promise.reject({ key: 'documents_using_template', value: count });
    }
    await translations.deleteContext(template._id);
    await removePropsWithUnexistentId(template._id);
    await model.delete(template._id);

    return template;
  },

  countByTemplate(template) {
    return entities.countByTemplate(template);
  },

  getEntitySelectNames(templateId) {
    return this.getById(templateId).then(template => {
      const selects = template.properties.filter(
        prop => prop.type === 'select' || prop.type === 'multiselect'
      );
      const entitySelects = [];
      return Promise.all(
        selects.map(select =>
          request.get(`${dbURL}/${select.content}`).then(result => {
            if (result.json.type === 'template') {
              entitySelects.push(select.name);
            }
          })
        )
      ).then(() => entitySelects);
    });
  },

  countByThesauri(thesauriId) {
    return model.count({ 'properties.content': thesauriId });
  },
};
