/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { FeatureSet } from '../spec-configuration/containerFeaturesConfiguration';
import { DevContainerConfig } from './configuration';

interface FeatureNode {
    feature: FeatureSet;
    before: Set<FeatureNode>;
    after: Set<FeatureNode>;
}

export function computeFeatureInstallationOrder(config: DevContainerConfig, features: FeatureSet[]) {

    if (config.overrideFeatureInstallOrder) {
        return computeOverrideInstallationOrder(config, features);
    }
    else {
        return computeInstallationOrder(features);
    }
}

// Exported for unit tests.
export function computeOverrideInstallationOrder(config: DevContainerConfig, features: FeatureSet[]) {
    // Starts with the automatic installation order.
    const automaticOrder = computeInstallationOrder(features);

    // Moves to the beginning the features that are explicitly configured.
    const orderedFeatures = [];
    for (const featureId of config.overrideFeatureInstallOrder!) {
        // Reference: https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-features.md#1-overridefeatureinstallorder
        const feature = automaticOrder.find(feature => feature.sourceInformation.userFeatureIdWithoutVersion === featureId || feature.sourceInformation.userFeatureId === featureId);
        if (!feature) {
            throw new Error(`Feature ${featureId} not found`);
        }
        orderedFeatures.push(feature);
        features.splice(features.indexOf(feature), 1);
    }

    return orderedFeatures.concat(features);
}

// Exported for unit tests.
export function computeInstallationOrder(features: FeatureSet[]) {
    const nodesById = features.map<FeatureNode>(feature => ({
        feature,
        before: new Set(),
        after: new Set(),
    })).reduce((map, feature) => map.set(feature.feature.sourceInformation.userFeatureId, feature), new Map<string, FeatureNode>());

    const nodes = [...nodesById.values()];
    for (const later of nodes) {
        for (const firstId of later.feature.features[0].installAfter || []) {
            const first = nodesById.get(firstId);
            // soft dependencies
            if (first) {
                later.after.add(first);
                first.before.add(later);
            }
        }
    }

    const { roots, islands } = nodes.reduce((prev, node) => {
        if (node.after.size === 0) {
            if (node.before.size === 0) {
                prev.islands.push(node);
            } else {
                prev.roots.push(node);
            }
        }
        return prev;
    }, { roots: [] as FeatureNode[], islands: [] as FeatureNode[] });

    const orderedFeatures = [];
    let current = roots;
    while (current.length) {
        const next = [];
        for (const first of current) {
            for (const later of first.before) {
                later.after.delete(first);
                if (later.after.size === 0) {
                    next.push(later);
                }
            }
        }
        orderedFeatures.push(
            ...current.map(node => node.feature)
                .sort((a, b) => a.sourceInformation.userFeatureId.localeCompare(b.sourceInformation.userFeatureId)) // stable order
        );
        current = next;
    }

    orderedFeatures.push(
        ...islands.map(node => node.feature)
            .sort((a, b) => a.sourceInformation.userFeatureId.localeCompare(b.sourceInformation.userFeatureId)) // stable order
    );

    const missing = new Set(nodesById.keys());
    for (const feature of orderedFeatures) {
        missing.delete(feature.sourceInformation.userFeatureId);
    }

    if (missing.size !== 0) {
        throw new Error(`Features declare cyclic dependency: ${[...missing].join(', ')}`);
    }

    return orderedFeatures;
}